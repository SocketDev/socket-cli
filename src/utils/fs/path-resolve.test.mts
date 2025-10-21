import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mockFs from 'mock-fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizePath } from '@socketsecurity/lib/path'
import { NODE_MODULES } from '@socketsecurity/lib/constants/paths'


import {
  findBinPathDetailsSync,
  findNpmDirPathSync,
  getPackageFilesForScan,
} from './resolve.mts'
import { PACKAGE_LOCK_JSON, PNPM_LOCK_YAML, YARN_LOCK } from '../../constants/packages.mts'

const PACKAGE_JSON = 'package.json'

import type FileSystem from 'mock-fs/lib/filesystem'

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
  const actual = await vi.importActual<
    typeof import('@socketsecurity/lib/fs')
  >('@socketsecurity/lib/fs')
  return {
    ...actual,
    isDirSync: vi.fn(),
  }
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootNmPath = path.join(__dirname, '../..', NODE_MODULES)
const mockFixturePath = normalizePath(path.join(__dirname, 'mock'))
const mockNmPath = normalizePath(rootNmPath)
// Load the registry from its actual location (socket-registry/registry)
// because node_modules/@socketsecurity/registry is a symlink and require follows it
const actualRegistryPath = path.resolve(
  __dirname,
  '../../../socket-registry/registry',
)
const mockRegistryDist = mockFs.load(path.join(actualRegistryPath, 'dist'))
const mockRegistryPackageJson = mockFs.load(
  path.join(actualRegistryPath, 'package.json'),
)

function mockTestFs(config: FileSystem.DirectoryItems) {
  // Don't load entire node_modules to avoid ENAMETOOLONG from circular symlinks
  // between @socketregistry/packageurl-js and @socketsecurity/registry.
  // Instead, load only the registry from its actual location since require follows symlinks.
  return mockFs({
    ...config,
    [mockNmPath]: {},
    [actualRegistryPath]: {
      dist: mockRegistryDist,
      'package.json': mockRegistryPackageJson,
    },
  })
}

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
  afterEach(() => {
    mockFs.restore()
  })

  describe('getPackageFilesForScan()', () => {
    it('should handle a "." inputPath', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(['.'], globPatterns, {
        cwd: mockFixturePath,
      })
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should handle a directory path input', async () => {
      const subDirPath = normalizePath(path.join(mockFixturePath, 'subdir'))
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${subDirPath}/package.json`]: '{}',
        [`${subDirPath}/nested/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        [subDirPath],
        globPatterns,
        {
          cwd: mockFixturePath,
        },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${subDirPath}/nested/package.json`,
        `${subDirPath}/package.json`,
      ])
    })

    it('should respect ignores from socket config', async () => {
      mockTestFs({
        [`${mockFixturePath}/bar/package-lock.json`]: '{}',
        [`${mockFixturePath}/bar/package.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        {
          cwd: mockFixturePath,
          config: {
            version: 2,
            projectIgnorePaths: ['bar/*', '!bar/package.json'],
            issueRules: {},
            githubApp: {},
          },
        },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/bar/package.json`,
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`,
      ])
    })

    it('should respect .gitignore', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'bar/*\n!bar/package.json',
        [`${mockFixturePath}/bar/package-lock.json`]: '{}',
        [`${mockFixturePath}/bar/package.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/bar/package.json`,
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`,
      ])
    })

    it('should always ignore some paths', async () => {
      mockTestFs({
        // Mirrors the list from
        // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
        [`${mockFixturePath}/.git/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/.log/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/.nyc_output/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/.sass-cache/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/.yarn/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/bower_components/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/coverage/some/dir/package.json`]: '{}',
        [`${mockFixturePath}/node_modules/socket/package.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`,
      ])
    })

    it('should ignore irrelevant matches', async () => {
      mockTestFs({
        [`${mockFixturePath}/foo/package-foo.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}',
        [`${mockFixturePath}/foo/random.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`,
      ])
    })

    it('should be lenient on oddities', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: {
          /* Empty directory */
        },
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([])
    })

    it('should resolve package and lockfile', async () => {
      mockTestFs({
        [`${mockFixturePath}/package-lock.json`]: '{}',
        [`${mockFixturePath}/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package-lock.json`,
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should resolve package without lockfile', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should support alternative lockfiles', async () => {
      mockTestFs({
        [`${mockFixturePath}/yarn.lock`]: '{}',
        [`${mockFixturePath}/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`,
        `${mockFixturePath}/yarn.lock`,
      ])
    })

    it('should handle all variations', async () => {
      mockTestFs({
        [`${mockFixturePath}/package-lock.json`]: '{}',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}',
        [`${mockFixturePath}/bar/yarn.lock`]: '{}',
        [`${mockFixturePath}/bar/package.json`]: '{}',
        [`${mockFixturePath}/abc/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        ['**/*'],
        globPatterns,
        { cwd: mockFixturePath },
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/abc/package.json`,
        `${mockFixturePath}/bar/package.json`,
        `${mockFixturePath}/bar/yarn.lock`,
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`,
        `${mockFixturePath}/package-lock.json`,
        `${mockFixturePath}/package.json`,
      ])
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
      const constants = await import('../constants.mts')
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
      const constants = await import('../constants.mts')
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
      const { isDirSync } = vi.mocked(
        await import('@socketsecurity/lib/fs'),
      )

      isDirSync.mockImplementation(p => {
        const pathStr = String(p)
        if (pathStr.includes('lib/node_modules/npm')) {
          return true
        }
        if (pathStr.endsWith('/node_modules')) {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync('/usr/local/bin/npm')

      expect(result).toBe('/usr/local/bin/npm/lib/node_modules/npm')
    })

    it('finds npm directory with node_modules in current path', async () => {
      const { isDirSync } = vi.mocked(
        await import('@socketsecurity/lib/fs'),
      )

      isDirSync.mockImplementation(p => {
        const pathStr = String(p)
        if (pathStr === '/usr/local/npm/node_modules') {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync('/usr/local/npm')

      expect(result).toBe('/usr/local/npm')
    })

    it('finds npm directory with node_modules in parent path', async () => {
      const { isDirSync } = vi.mocked(
        await import('@socketsecurity/lib/fs'),
      )

      isDirSync.mockImplementation(p => {
        const pathStr = String(p)
        if (pathStr === '/usr/local/npm/node_modules') {
          return false
        }
        if (pathStr === '/usr/local/node_modules') {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync('/usr/local/npm')

      expect(result).toBe('/usr/local')
    })

    it('returns undefined when no npm directory found', async () => {
      const { isDirSync } = vi.mocked(
        await import('@socketsecurity/lib/fs'),
      )

      isDirSync.mockReturnValue(false)

      const result = findNpmDirPathSync('/random/path')

      expect(result).toBeUndefined()
    })

    it('handles nvm directory structure', async () => {
      const { isDirSync } = vi.mocked(
        await import('@socketsecurity/lib/fs'),
      )

      isDirSync.mockImplementation(p => {
        const pathStr = String(p)
        if (pathStr.includes('.nvm') && pathStr.endsWith('/node_modules')) {
          return true
        }
        return false
      })

      const result = findNpmDirPathSync(
        '/Users/user/.nvm/versions/node/v18.0.0/bin/npm',
      )

      expect(result).toBe('/Users/user/.nvm/versions/node/v18.0.0/bin/npm')
    })
  })
})
