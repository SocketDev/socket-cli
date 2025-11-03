import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractOverridesFromPnpmLockSrc,
  extractPurlsFromPnpmLockfile,
  isPnpmDepPath,
  parsePnpmLockfile,
  parsePnpmLockfileVersion,
  readPnpmLockfile,
  stripLeadingPnpmDepPathSlash,
  stripPnpmPeerSuffix,
} from '../../../../src/src/pnpm/lockfile.mts'

// Mock fs module.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

// Mock registry modules.
vi.mock('@socketsecurity/lib/fs', () => ({
  readFileUtf8: vi.fn(),
}))

describe('pnpm utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractOverridesFromPnpmLockSrc', () => {
    it('extracts overrides section from lockfile content', () => {
      const lockfileContent = `lockfileVersion: 5.4
overrides:
  lodash: 4.17.21
  react: 18.0.0

dependencies:
  express: 4.18.0`
      const result = extractOverridesFromPnpmLockSrc(lockfileContent)
      expect(result).toBe('overrides:\n  lodash: 4.17.21\n  react: 18.0.0\n\n')
    })

    it('returns empty string when no overrides section', () => {
      const lockfileContent = `lockfileVersion: 5.4
dependencies:
  express: 4.18.0`
      const result = extractOverridesFromPnpmLockSrc(lockfileContent)
      expect(result).toBe('')
    })

    it('returns empty string for non-string input', () => {
      expect(extractOverridesFromPnpmLockSrc({})).toBe('')
      expect(extractOverridesFromPnpmLockSrc(null)).toBe('')
      expect(extractOverridesFromPnpmLockSrc(undefined)).toBe('')
    })

    it('handles Windows line endings', () => {
      const lockfileContent =
        'lockfileVersion: 5.4\r\noverrides:\r\n  lodash: 4.17.21\r\n\r\ndependencies:'
      const result = extractOverridesFromPnpmLockSrc(lockfileContent)
      expect(result).toBe('overrides:\r\n  lodash: 4.17.21\r\n\r\n')
    })
  })

  describe('isPnpmDepPath', () => {
    it('identifies pnpm dependency paths', () => {
      expect(isPnpmDepPath('/lodash@4.17.21')).toBe(true)
      expect(isPnpmDepPath('/express@4.18.0')).toBe(true)
      expect(isPnpmDepPath('/@babel/core@7.0.0')).toBe(true)
    })

    it('returns false for non-dependency paths', () => {
      expect(isPnpmDepPath('lodash@4.17.21')).toBe(false)
      expect(isPnpmDepPath('')).toBe(false)
      expect(isPnpmDepPath('4.17.21')).toBe(false)
    })
  })

  describe('parsePnpmLockfile', () => {
    it('parses valid YAML lockfile content', () => {
      const lockfileContent = `lockfileVersion: 5.4
packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-test}
    dev: false`

      const result = parsePnpmLockfile(lockfileContent)
      expect(result).toBeDefined()
      expect(result?.lockfileVersion).toBe(5.4)
      expect(result?.packages).toBeDefined()
    })

    it('handles BOM in lockfile content', () => {
      const lockfileContent =
        '\ufeff' +
        `lockfileVersion: 5.4
packages: {}`

      const result = parsePnpmLockfile(lockfileContent)
      expect(result).toBeDefined()
      expect(result?.lockfileVersion).toBe(5.4)
    })

    it('returns null for invalid YAML', () => {
      const lockfileContent = '{not: valid yaml'
      const result = parsePnpmLockfile(lockfileContent)
      expect(result).toBeNull()
    })

    it('returns null for non-string input', () => {
      expect(parsePnpmLockfile(123)).toBeNull()
      expect(parsePnpmLockfile(null)).toBeNull()
      expect(parsePnpmLockfile(undefined)).toBeNull()
    })

    it('returns null for non-object result', () => {
      const lockfileContent = `"just a string"`
      const result = parsePnpmLockfile(lockfileContent)
      expect(result).toBeNull()
    })
  })

  describe('parsePnpmLockfileVersion', () => {
    it('parses valid version numbers', () => {
      const result = parsePnpmLockfileVersion('5.4')
      expect(result).toBeDefined()
      expect(result?.major).toBe(5)
      expect(result?.minor).toBe(4)
      expect(result?.patch).toBe(0)
    })

    it('coerces partial versions', () => {
      const result = parsePnpmLockfileVersion('5')
      expect(result).toBeDefined()
      expect(result?.major).toBe(5)
      expect(result?.minor).toBe(0)
      expect(result?.patch).toBe(0)
    })

    it('returns undefined for invalid versions', () => {
      expect(parsePnpmLockfileVersion('not a version')).toBeUndefined()
      expect(parsePnpmLockfileVersion(null)).toBeUndefined()
      expect(parsePnpmLockfileVersion(undefined)).toBeUndefined()
      expect(parsePnpmLockfileVersion({})).toBeUndefined()
    })
  })

  describe('readPnpmLockfile', () => {
    it('reads existing lockfile', async () => {
      const { existsSync } = await import('node:fs')
      const { readFileUtf8 } = await import('@socketsecurity/lib/fs')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileUtf8).mockResolvedValue('lockfile content')

      const result = await readPnpmLockfile('/path/to/pnpm-lock.yaml')
      expect(result).toBe('lockfile content')
      expect(existsSync).toHaveBeenCalledWith('/path/to/pnpm-lock.yaml')
      expect(readFileUtf8).toHaveBeenCalledWith('/path/to/pnpm-lock.yaml')
    })

    it('returns undefined for non-existent lockfile', async () => {
      const { existsSync } = await import('node:fs')

      vi.mocked(existsSync).mockReturnValue(false)

      const result = await readPnpmLockfile('/path/to/missing.yaml')
      expect(result).toBeUndefined()
    })
  })

  describe('stripLeadingPnpmDepPathSlash', () => {
    it('strips leading slash from dependency paths', () => {
      expect(stripLeadingPnpmDepPathSlash('/lodash@4.17.21')).toBe(
        'lodash@4.17.21',
      )
      expect(stripLeadingPnpmDepPathSlash('/@babel/core@7.0.0')).toBe(
        '@babel/core@7.0.0',
      )
    })

    it('returns unchanged for non-dependency paths', () => {
      expect(stripLeadingPnpmDepPathSlash('lodash@4.17.21')).toBe(
        'lodash@4.17.21',
      )
      expect(stripLeadingPnpmDepPathSlash('')).toBe('')
    })
  })

  describe('stripPnpmPeerSuffix', () => {
    it('strips peer dependency suffix with parentheses', () => {
      expect(stripPnpmPeerSuffix('react@18.0.0(react-dom@18.0.0)')).toBe(
        'react@18.0.0',
      )
      expect(stripPnpmPeerSuffix('vue@3.0.0(typescript@4.0.0)')).toBe(
        'vue@3.0.0',
      )
    })

    it('strips peer dependency suffix with underscore', () => {
      expect(stripPnpmPeerSuffix('react@18.0.0_react-dom@18.0.0')).toBe(
        'react@18.0.0',
      )
      expect(stripPnpmPeerSuffix('vue@3.0.0_typescript@4.0.0')).toBe(
        'vue@3.0.0',
      )
    })

    it('prefers parentheses over underscore', () => {
      expect(stripPnpmPeerSuffix('pkg@1.0.0(peer)_other')).toBe('pkg@1.0.0')
    })

    it('returns unchanged for paths without suffixes', () => {
      expect(stripPnpmPeerSuffix('lodash@4.17.21')).toBe('lodash@4.17.21')
      expect(stripPnpmPeerSuffix('@babel/core@7.0.0')).toBe('@babel/core@7.0.0')
    })
  })

  describe('extractPurlsFromPnpmLockfile', () => {
    it('extracts PURLs from lockfile with dependencies', async () => {
      const lockfile = {
        lockfileVersion: 5.4,
        packages: {
          '/lodash@4.17.21': {
            resolution: { integrity: 'sha512-test' },
            dev: false,
          },
          '/express@4.18.0': {
            resolution: { integrity: 'sha512-test2' },
            dependencies: {
              'body-parser': '1.19.0',
            },
            dev: false,
          },
          '/body-parser@1.19.0': {
            resolution: { integrity: 'sha512-test3' },
            dev: false,
          },
        },
      }

      const purls = await extractPurlsFromPnpmLockfile(lockfile)
      expect(purls).toContain('pkg:npm/lodash@4.17.21')
      expect(purls).toContain('pkg:npm/express@4.18.0')
      expect(purls).toContain('pkg:npm/body-parser@1.19.0')
    })

    it('handles optional and dev dependencies', async () => {
      const lockfile = {
        lockfileVersion: 5.4,
        packages: {
          '/main@1.0.0': {
            resolution: { integrity: 'sha512-test' },
            dependencies: {
              dep: '1.0.0',
            },
            optionalDependencies: {
              optional: '1.0.0',
            },
            devDependencies: {
              dev: '1.0.0',
            },
          },
          '/dep@1.0.0': {
            resolution: { integrity: 'sha512-test2' },
          },
          '/optional@1.0.0': {
            resolution: { integrity: 'sha512-test3' },
          },
          '/dev@1.0.0': {
            resolution: { integrity: 'sha512-test4' },
          },
        },
      }

      const purls = await extractPurlsFromPnpmLockfile(lockfile)
      expect(purls).toHaveLength(4)
      expect(purls).toContain('pkg:npm/main@1.0.0')
      expect(purls).toContain('pkg:npm/dep@1.0.0')
      expect(purls).toContain('pkg:npm/optional@1.0.0')
      expect(purls).toContain('pkg:npm/dev@1.0.0')
    })

    it('handles circular dependencies', async () => {
      const lockfile = {
        lockfileVersion: 5.4,
        packages: {
          '/a@1.0.0': {
            resolution: { integrity: 'sha512-test' },
            dependencies: {
              b: '1.0.0',
            },
          },
          '/b@1.0.0': {
            resolution: { integrity: 'sha512-test2' },
            dependencies: {
              a: '1.0.0',
            },
          },
        },
      }

      const purls = await extractPurlsFromPnpmLockfile(lockfile)
      expect(purls).toHaveLength(2)
      expect(purls).toContain('pkg:npm/a@1.0.0')
      expect(purls).toContain('pkg:npm/b@1.0.0')
    })

    it('handles empty lockfile', async () => {
      const lockfile = {
        lockfileVersion: 5.4,
      }

      const purls = await extractPurlsFromPnpmLockfile(lockfile)
      expect(purls).toEqual([])
    })

    it('handles lockfile with no packages', async () => {
      const lockfile = {
        lockfileVersion: 5.4,
        packages: {},
      }

      const purls = await extractPurlsFromPnpmLockfile(lockfile)
      expect(purls).toEqual([])
    })
  })
})
