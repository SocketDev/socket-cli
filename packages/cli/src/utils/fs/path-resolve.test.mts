import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizePath } from '@socketsecurity/lib/path'

import {
  createTestWorkspace,
  type Workspace,
} from '../../../test/helpers/workspace-helper.mts'
import {
  findBinPathDetailsSync,
  findNpmDirPathSync,
  getPackageFilesForScan,
} from './path-resolve.mts'
import {
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../../constants/packages.mts'

const PACKAGE_JSON = 'package.json'

// Mock dependencies for new tests.
vi.mock('@socketsecurity/lib/bin', async () => {
  const actual = await vi.importActual<
    typeof import('@socketsecurity/lib/bin')
  >('@socketsecurity/lib/bin')
  return {
    ...actual,
    resolveBinPathSync: vi.fn(p => p),
    whichBinSync: vi.fn(),
  }
})

vi.mock('@socketsecurity/lib/fs', async () => {
  const actual = await vi.importActual<typeof import('@socketsecurity/lib/fs')>(
    '@socketsecurity/lib/fs',
  )
  return {
    ...actual,
    isDirSync: vi.fn(),
  }
})

const globPatterns = {
  general: {
    readme: {
      pattern: '*readme*',
    },
    notice: {
      pattern: '*notice*',
    },
    license: {
      pattern: '{licen{s,c}e{,-*},copying}',
    },
  },
  npm: {
    packagejson: {
      pattern: PACKAGE_JSON,
    },
    packagelockjson: {
      pattern: PACKAGE_LOCK_JSON,
    },
    npmshrinkwrap: {
      pattern: 'npm-shrinkwrap.json',
    },
    yarnlock: {
      pattern: YARN_LOCK,
    },
    pnpmlock: {
      pattern: PNPM_LOCK_YAML,
    },
    pnpmworkspace: {
      pattern: 'pnpm-workspace.yaml',
    },
  },
  pypi: {
    pipfile: {
      pattern: 'pipfile',
    },
    pyproject: {
      pattern: 'pyproject.toml',
    },
    requirements: {
      pattern:
        '{*requirements.txt,requirements/*.txt,requirements-*.txt,requirements.frozen}',
    },
    setuppy: {
      pattern: 'setup.py',
    },
  },
}

type Fn = (...args: any[]) => Promise<any[]>

const sortedPromise =
  (fn: Fn) =>
  async (...args: any[]) => {
    const result = await fn(...args)
    return result.sort()
  }
const sortedGetPackageFilesFullScans = sortedPromise(getPackageFilesForScan)

describe('Path Resolve', () => {
  describe('getPackageFilesForScan()', () => {
    it('should handle a "." inputPath', async () => {
      const workspace = await createTestWorkspace({
        packageJson: { name: 'test' },
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['.'],
          globPatterns,
          {
            cwd: workspace.path,
          },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should respect ignores from socket config', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'bar/package-lock.json', content: '{}' },
          { path: 'bar/package.json', content: '{}' },
          { path: 'foo/package-lock.json', content: '{}' },
          { path: 'foo/package.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          {
            cwd: workspace.path,
            config: {
              version: 2,
              projectIgnorePaths: ['bar/*', '!bar/package.json'],
              issueRules: {},
              githubApp: {},
            },
          },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('bar/package.json')),
          normalizePath(workspace.resolve('foo/package-lock.json')),
          normalizePath(workspace.resolve('foo/package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should respect .gitignore', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: '.gitignore', content: 'bar/*\n!bar/package.json' },
          { path: 'bar/package-lock.json', content: '{}' },
          { path: 'bar/package.json', content: '{}' },
          { path: 'foo/package-lock.json', content: '{}' },
          { path: 'foo/package.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('bar/package.json')),
          normalizePath(workspace.resolve('foo/package-lock.json')),
          normalizePath(workspace.resolve('foo/package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should always ignore some paths', async () => {
      const workspace = await createTestWorkspace({
        files: [
          // Mirrors the list from
          // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
          { path: '.git/some/dir/package.json', content: '{}' },
          { path: '.log/some/dir/package.json', content: '{}' },
          { path: '.nyc_output/some/dir/package.json', content: '{}' },
          { path: '.sass-cache/some/dir/package.json', content: '{}' },
          { path: '.yarn/some/dir/package.json', content: '{}' },
          { path: 'bower_components/some/dir/package.json', content: '{}' },
          { path: 'coverage/some/dir/package.json', content: '{}' },
          { path: 'node_modules/socket/package.json', content: '{}' },
          { path: 'foo/package-lock.json', content: '{}' },
          { path: 'foo/package.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('foo/package-lock.json')),
          normalizePath(workspace.resolve('foo/package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should ignore irrelevant matches', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'foo/package-foo.json', content: '{}' },
          { path: 'foo/package-lock.json', content: '{}' },
          { path: 'foo/package.json', content: '{}' },
          { path: 'foo/random.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('foo/package-lock.json')),
          normalizePath(workspace.resolve('foo/package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should be lenient on oddities', async () => {
      const workspace = await createTestWorkspace({})

      try {
        // Create empty package.json directory (not a file)
        await workspace.writeFile('package.json/.gitkeep', '')

        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should resolve package and lockfile', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'package-lock.json', content: '{}' },
          { path: 'package.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('package-lock.json')),
          normalizePath(workspace.resolve('package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should resolve package without lockfile', async () => {
      const workspace = await createTestWorkspace({
        files: [{ path: 'package.json', content: '{}' }],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should support alternative lockfiles', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'yarn.lock', content: '{}' },
          { path: 'package.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('package.json')),
          normalizePath(workspace.resolve('yarn.lock')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })

    it('should handle all variations', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'package-lock.json', content: '{}' },
          { path: 'package.json', content: '{}' },
          { path: 'foo/package-lock.json', content: '{}' },
          { path: 'foo/package.json', content: '{}' },
          { path: 'bar/yarn.lock', content: '{}' },
          { path: 'bar/package.json', content: '{}' },
          { path: 'abc/package.json', content: '{}' },
        ],
      })

      try {
        const actual = await sortedGetPackageFilesFullScans(
          ['**/*'],
          globPatterns,
          { cwd: workspace.path },
        )
        expect(actual.map(normalizePath)).toEqual([
          normalizePath(workspace.resolve('abc/package.json')),
          normalizePath(workspace.resolve('bar/package.json')),
          normalizePath(workspace.resolve('bar/yarn.lock')),
          normalizePath(workspace.resolve('foo/package-lock.json')),
          normalizePath(workspace.resolve('foo/package.json')),
          normalizePath(workspace.resolve('package-lock.json')),
          normalizePath(workspace.resolve('package.json')),
        ])
      } finally {
        await workspace.cleanup()
      }
    })
  })

  describe('findBinPathDetailsSync', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('finds bin path when available', async () => {
      const { whichBinSync } = vi.mocked(
        await import('@socketsecurity/lib/bin'),
      )
      whichBinSync.mockReturnValue(['/usr/local/bin/npm'])

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
    })

    it('handles shadowed bin paths', async () => {
      const constants = await import('../../constants.mts')
      const shadowBinPath = constants.default.shadowBinPath
      const { whichBinSync } = vi.mocked(
        await import('@socketsecurity/lib/bin'),
      )
      whichBinSync.mockReturnValue([
        `${shadowBinPath}/npm`,
        '/usr/local/bin/npm',
      ])

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: '/usr/local/bin/npm',
        shadowed: true,
      })
    })

    it('handles no bin path found', async () => {
      const { whichBinSync } = vi.mocked(
        await import('@socketsecurity/lib/bin'),
      )
      whichBinSync.mockReturnValue(null)

      const result = findBinPathDetailsSync('nonexistent')

      expect(result).toEqual({
        name: 'nonexistent',
        path: undefined,
        shadowed: false,
      })
    })

    it('handles empty array result', async () => {
      const { whichBinSync } = vi.mocked(
        await import('@socketsecurity/lib/bin'),
      )
      whichBinSync.mockReturnValue([])

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: undefined,
        shadowed: false,
      })
    })

    it('handles single string result', async () => {
      const { whichBinSync } = vi.mocked(
        await import('@socketsecurity/lib/bin'),
      )
      whichBinSync.mockReturnValue('/usr/local/bin/npm' as any)

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: '/usr/local/bin/npm',
        shadowed: false,
      })
    })

    it('handles only shadow bin in path', async () => {
      const constants = await import('../../constants.mts')
      const shadowBinPath = constants.default.shadowBinPath
      const { whichBinSync } = vi.mocked(
        await import('@socketsecurity/lib/bin'),
      )
      whichBinSync.mockReturnValue([`${shadowBinPath}/npm`])

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: undefined,
        shadowed: true,
      })
    })
  })

  describe('findNpmDirPathSync', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('finds npm directory in lib/node_modules structure', async () => {
      const { isDirSync } = vi.mocked(await import('@socketsecurity/lib/fs'))

      isDirSync.mockImplementation(p => {
        const pathStr = normalizePath(String(p))
        if (pathStr.includes('lib/node_modules/npm')) {
          return true
        }
        if (pathStr.endsWith('/node_modules')) {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync('/usr/local/bin/npm')

      expect(normalizePath(result)).toBe(normalizePath('/usr/local/bin/npm/lib/node_modules/npm'))
    })

    it('finds npm directory with node_modules in current path', async () => {
      const { isDirSync } = vi.mocked(await import('@socketsecurity/lib/fs'))

      isDirSync.mockImplementation(p => {
        const pathStr = normalizePath(String(p))
        if (pathStr === normalizePath('/usr/local/npm/node_modules')) {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync('/usr/local/npm')

      expect(normalizePath(result)).toBe(normalizePath('/usr/local/npm'))
    })

    it('finds npm directory with node_modules in parent path', async () => {
      const { isDirSync } = vi.mocked(await import('@socketsecurity/lib/fs'))

      isDirSync.mockImplementation(p => {
        const pathStr = normalizePath(String(p))
        if (pathStr === normalizePath('/usr/local/npm/node_modules')) {
          return false
        }
        if (pathStr === normalizePath('/usr/local/node_modules')) {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync('/usr/local/npm')

      expect(normalizePath(result)).toBe(normalizePath('/usr/local'))
    })

    it('returns undefined when no npm directory found', async () => {
      const { isDirSync } = vi.mocked(await import('@socketsecurity/lib/fs'))

      isDirSync.mockReturnValue(false)

      const result = findNpmDirPathSync('/random/path')

      expect(result).toBeUndefined()
    })

    it('handles nvm directory structure', async () => {
      const { isDirSync } = vi.mocked(await import('@socketsecurity/lib/fs'))

      isDirSync.mockImplementation(p => {
        const pathStr = normalizePath(String(p))
        if (pathStr.includes('.nvm') && pathStr.endsWith('/node_modules')) {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync(
        '/Users/user/.nvm/versions/node/v18.0.0/bin/npm',
      )

      expect(normalizePath(result)).toBe(normalizePath('/Users/user/.nvm/versions/node/v18.0.0/bin/npm'))
    })
  })
})
