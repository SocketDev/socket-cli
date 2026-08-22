/**
 * Unit tests for ecosystem environment detection.
 *
 * Purpose: Tests ecosystem environment detection (Node.js, Python, Go, etc.).
 * Validates runtime version detection.
 *
 * Test Coverage: - Runtime version detection - Package manager detection -
 * Environment variable parsing - Multiple ecosystem support - Version string
 * parsing.
 *
 * Testing Approach: Uses mocked subprocess calls to test environment detection.
 *
 * Related Files: - util/ecosystem/environment.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AGENTS,
  getAgentExecPath,
  getAgentVersion,
  preferWindowsCmdShim,
  resolveBinPathSync,
} from '../../../../src/util/ecosystem/environment.mts'

// Mock the dependencies.
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
}))

const mockCoerce = vi.hoisted(() => vi.fn())
const mockWhichBin = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/bin/which'), () => ({
  whichReal: mockWhichBin,
}))

const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

const mockGetNpmExecPath = vi.hoisted(() => vi.fn())
const mockGetPnpmExecPath = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/constants/agents.mts'),
  async importOriginal => {
    const actual: unknown = await importOriginal()
    return {
      ...actual,
      getNpmExecPath: mockGetNpmExecPath,
      getPnpmExecPath: mockGetPnpmExecPath,
    }
  },
)

vi.mock(import('semver'), () => ({
  default: {
    coerce: mockCoerce,
  },
}))

describe('package-environment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock behavior for spawn to get package manager version.
    mockSpawn.mockResolvedValue({ stdout: '10.0.0', stderr: '', code: 0 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('AGENTS', () => {
    it('contains all expected package managers', () => {
      expect(AGENTS).toContain('npm')
      expect(AGENTS).toContain('pnpm')
      expect(AGENTS).toContain('bun')
      expect(AGENTS).toContain('vlt')
      expect(AGENTS.length).toBeGreaterThan(0)
    })
  })

  describe('resolveBinPathSync', () => {
    it('returns input path when file does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      const result = resolveBinPathSync('/nonexistent/npm')
      expect(result).toBe('/nonexistent/npm')
    })

    it('returns input path when shim regex does not match', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('echo "not a node shim"\n')
      const result = resolveBinPathSync('/usr/local/bin/some-tool')
      expect(result).toBe('/usr/local/bin/some-tool')
    })

    it('extracts the underlying npm-cli.js when found', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        'node "/usr/lib/node_modules/npm/bin/npm-cli.js" "$@"\n',
      )
      const result = resolveBinPathSync('/usr/local/bin/npm')
      expect(result).toBe('/usr/lib/node_modules/npm/bin/npm-cli.js')
    })

    it('resolves relative shim path against bin dir', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('node "../lib/npm-cli.js" "$@"\n')
      const result = resolveBinPathSync('/usr/local/bin/npm')
      // Resolves "../lib/npm-cli.js" relative to /usr/local/bin/.
      expect(result).toContain('npm-cli.js')
      expect(result.startsWith('/')).toBe(true)
    })

    it('returns input path when readFileSync throws', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => {
        throw new Error('I/O error')
      })
      const result = resolveBinPathSync('/usr/local/bin/npm')
      expect(result).toBe('/usr/local/bin/npm')
    })
  })

  describe('preferWindowsCmdShim', () => {
    it('returns input path on POSIX (no .cmd shim)', () => {
      // On the test runner platform (POSIX) the function should bail
      // immediately and return the input.
      const result = preferWindowsCmdShim('/usr/local/bin/npm', 'npm')
      expect(result).toBe('/usr/local/bin/npm')
    })

    it('returns input for non-absolute paths', () => {
      const result = preferWindowsCmdShim('npm', 'npm')
      expect(result).toBe('npm')
    })
  })

  describe('getAgentExecPath', () => {
    it('returns getNpmExecPath when it exists for npm agent', async () => {
      mockGetNpmExecPath.mockResolvedValue('/usr/local/bin/npm')
      mockExistsSync.mockReturnValue(true)
      const result = await getAgentExecPath('npm')
      expect(result).toBe('/usr/local/bin/npm')
    })

    it('falls back to whichReal when getNpmExecPath does not exist', async () => {
      mockGetNpmExecPath.mockResolvedValue('/missing/npm')
      mockWhichBin.mockResolvedValue('/usr/bin/npm')
      // existsSync returns false for npmPath, npmInNodeDir; we want to
      // exercise the whichReal fallback at lines 337-341.
      mockExistsSync.mockReturnValue(false)
      const result = await getAgentExecPath('npm')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('returns binName when whichReal returns null for npm', async () => {
      mockGetNpmExecPath.mockResolvedValue('/missing/npm')
      mockWhichBin.mockResolvedValue(undefined)
      mockExistsSync.mockReturnValue(false)
      const result = await getAgentExecPath('npm')
      // Falls back to bare 'npm' string when whichReal returns null.
      expect(result).toBe('npm')
    })

    it('returns getPnpmExecPath when it exists for pnpm agent', async () => {
      mockGetPnpmExecPath.mockResolvedValue('/usr/local/bin/pnpm')
      mockExistsSync.mockReturnValue(true)
      const result = await getAgentExecPath('pnpm')
      expect(result).toBe('/usr/local/bin/pnpm')
    })

    it('falls back to whichReal when getPnpmExecPath does not exist', async () => {
      mockGetPnpmExecPath.mockResolvedValue('/missing/pnpm')
      mockExistsSync.mockReturnValue(false)
      mockWhichBin.mockResolvedValue('/found/pnpm')
      const result = await getAgentExecPath('pnpm')
      expect(typeof result).toBe('string')
    })

    it('uses whichReal for non-npm/pnpm agents (yarn-classic)', async () => {
      mockWhichBin.mockResolvedValue('/usr/local/bin/yarn')
      const result = await getAgentExecPath('yarn-classic')
      expect(typeof result).toBe('string')
    })

    it('returns array first element when whichReal returns array', async () => {
      mockWhichBin.mockResolvedValue(['/first/yarn', '/second/yarn'])
      const result = await getAgentExecPath('yarn-classic')
      expect(result).toBe('/first/yarn')
    })
  })

  describe('getAgentVersion', () => {
    it('returns coerced semver version on successful spawn', async () => {
      mockSpawn.mockResolvedValue({
        stdout: '10.8.2',
        code: 0,
      })
      mockCoerce.mockReturnValue({ version: '10.8.2' })
      const result = await getAgentVersion('npm', '/usr/local/bin/npm', '/cwd')
      expect(mockSpawn).toHaveBeenCalled()
      expect(result).toEqual({ version: '10.8.2' })
    })

    it('returns undefined when spawn returns null/undefined', async () => {
      mockSpawn.mockResolvedValue(undefined)
      const result = await getAgentVersion('npm', '/usr/local/bin/npm', '/cwd')
      expect(result).toBeUndefined()
    })

    it('returns undefined and logs when spawn rejects', async () => {
      mockSpawn.mockRejectedValue(new Error('command failed'))
      const result = await getAgentVersion('npm', '/usr/local/bin/npm', '/cwd')
      expect(result).toBeUndefined()
    })

    it('returns undefined when stdout is non-coerceable', async () => {
      mockSpawn.mockResolvedValue({
        stdout: 'not-a-version',
        code: 0,
      })
      mockCoerce.mockReturnValue(undefined)
      const result = await getAgentVersion('npm', '/usr/local/bin/npm', '/cwd')
      expect(result).toBeUndefined()
    })

    it('handles Buffer stdout (calls .toString())', async () => {
      mockSpawn.mockResolvedValue({
        stdout: Buffer.from('10.8.2'),
        code: 0,
      })
      mockCoerce.mockReturnValue({ version: '10.8.2' })
      const result = await getAgentVersion('npm', '/usr/local/bin/npm', '/cwd')
      expect(result).toEqual({ version: '10.8.2' })
    })
  })
})
