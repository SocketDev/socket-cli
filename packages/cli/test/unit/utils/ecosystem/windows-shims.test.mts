/**
 * Unit tests for the Windows-shim resolution helpers.
 *
 * The helpers behave as no-ops on POSIX, so most assertions pivot on
 * stubbing the WIN32 constant from @socketsecurity/lib via vi.mock().
 */

import { describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())

// Mock fs so each test can dictate file existence and shim contents.
vi.mock('node:fs', async importOriginal => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  }
})

// Toggle the WIN32 export per test. Ships at module load, so we re-import
// the SUT inside each branch that needs a different platform.
const mockWin32 = vi.hoisted(() => ({ WIN32: false }))
vi.mock('@socketsecurity/lib/constants/platform', () => mockWin32)

import {
  preferWindowsCmdShim,
  resolveBinPathSync,
} from '../../../../src/utils/ecosystem/windows-shims.mts'

describe('windows-shims', () => {
  describe('resolveBinPathSync', () => {
    it('returns the input path verbatim when the file does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      expect(resolveBinPathSync('/nonexistent/npm')).toBe('/nonexistent/npm')
    })

    it('returns the input path when the file content has no shim pattern', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('echo "not a shim"\n')
      expect(resolveBinPathSync('/usr/bin/some-tool')).toBe(
        '/usr/bin/some-tool',
      )
    })

    it('extracts the absolute npm-cli.js path from a node-style shim', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        'node "/usr/lib/node_modules/npm/bin/npm-cli.js" "$@"\n',
      )
      expect(resolveBinPathSync('/usr/local/bin/npm')).toBe(
        '/usr/lib/node_modules/npm/bin/npm-cli.js',
      )
    })

    it('extracts the pnpm shim path', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        'node "/opt/pnpm/dist/pnpm.cjs" "$@"\n',
      )
      expect(resolveBinPathSync('/usr/local/bin/pnpm')).toBe(
        '/opt/pnpm/dist/pnpm.cjs',
      )
    })

    it('extracts the yarn shim path (.mjs extension)', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        'node "/opt/yarn/lib/yarn.mjs" "$@"\n',
      )
      expect(resolveBinPathSync('/usr/local/bin/yarn')).toBe(
        '/opt/yarn/lib/yarn.mjs',
      )
    })

    it('resolves a relative shim path against the bin dir', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('node "../lib/npm-cli.js" "$@"\n')
      const result = resolveBinPathSync('/usr/local/bin/npm')
      // path.resolve('/usr/local/bin', '../lib/npm-cli.js')
      expect(result).toContain('npm-cli.js')
      expect(result.startsWith('/')).toBe(true)
    })

    it('returns the input path when readFileSync throws', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES')
      })
      expect(resolveBinPathSync('/usr/local/bin/npm')).toBe(
        '/usr/local/bin/npm',
      )
    })
  })

  describe('preferWindowsCmdShim (POSIX)', () => {
    it('returns the input path verbatim on POSIX (WIN32 = false)', () => {
      mockWin32.WIN32 = false
      expect(preferWindowsCmdShim('/usr/local/bin/npm', 'npm')).toBe(
        '/usr/local/bin/npm',
      )
    })
  })

  describe('preferWindowsCmdShim (Windows)', () => {
    it('returns the input for non-absolute paths (line 68-69)', () => {
      mockWin32.WIN32 = true
      try {
        expect(preferWindowsCmdShim('npm', 'npm')).toBe('npm')
      } finally {
        mockWin32.WIN32 = false
      }
    })

    it('returns the input when path already has an extension (line 73-74)', () => {
      mockWin32.WIN32 = true
      try {
        expect(
          preferWindowsCmdShim('C:\\nodejs\\npm.exe', 'npm'),
        ).toBe('C:\\nodejs\\npm.exe')
      } finally {
        mockWin32.WIN32 = false
      }
    })

    it('returns the input when basename does not match binName (line 79-80)', () => {
      mockWin32.WIN32 = true
      try {
        expect(
          preferWindowsCmdShim('/usr/local/bin/wrong', 'npm'),
        ).toBe('/usr/local/bin/wrong')
      } finally {
        mockWin32.WIN32 = false
      }
    })

    it('returns the .cmd shim when one exists in the same dir (line 83-84)', () => {
      mockWin32.WIN32 = true
      mockExistsSync.mockReturnValue(true)
      try {
        const result = preferWindowsCmdShim('/usr/local/bin/npm', 'npm')
        // path.join → /usr/local/bin/npm.cmd
        expect(result).toContain('npm.cmd')
      } finally {
        mockWin32.WIN32 = false
      }
    })

    it('falls back to input when .cmd shim does not exist (line 84)', () => {
      mockWin32.WIN32 = true
      mockExistsSync.mockReturnValue(false)
      try {
        expect(preferWindowsCmdShim('/usr/local/bin/npm', 'npm')).toBe(
          '/usr/local/bin/npm',
        )
      } finally {
        mockWin32.WIN32 = false
      }
    })

    it('basename comparison is case-insensitive', () => {
      mockWin32.WIN32 = true
      mockExistsSync.mockReturnValue(true)
      try {
        const result = preferWindowsCmdShim('/usr/local/bin/NPM', 'npm')
        // Match succeeds because lowercased equality holds.
        expect(result).toContain('.cmd')
      } finally {
        mockWin32.WIN32 = false
      }
    })
  })
})
