import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mockFs from 'mock-fs'
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import { getPackageFilesForScan } from '../src/utils/path-resolve.mts'

import type FileSystem from 'mock-fs/lib/filesystem'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const testPath = __dirname
const rootNmPath = path.join(testPath, '../node_modules')

const mockFixturePath = normalizePath(path.join(testPath, 'mock'))
const mockNmPath = normalizePath(rootNmPath)
const mockedNmCallback = mockFs.load(rootNmPath)

function mockTestFs(config: FileSystem.DirectoryItems) {
  return mockFs({
    ...config,
    [mockNmPath]: mockedNmCallback
  })
}

const globPatterns = {
  general: {
    readme: {
      pattern: '*readme*'
    },
    notice: {
      pattern: '*notice*'
    },
    license: {
      pattern: '{licen{s,c}e{,-*},copying}'
    }
  },
  npm: {
    packagejson: {
      pattern: 'package.json'
    },
    packagelockjson: {
      pattern: 'package-lock.json'
    },
    npmshrinkwrap: {
      pattern: 'npm-shrinkwrap.json'
    },
    yarnlock: {
      pattern: 'yarn.lock'
    },
    pnpmlock: {
      pattern: 'pnpm-lock.yaml'
    },
    pnpmworkspace: {
      pattern: 'pnpm-workspace.yaml'
    }
  },
  pypi: {
    pipfile: {
      pattern: 'pipfile'
    },
    pyproject: {
      pattern: 'pyproject.toml'
    },
    requirements: {
      pattern:
        '{*requirements.txt,requirements/*.txt,requirements-*.txt,requirements.frozen}'
    },
    setuppy: {
      pattern: 'setup.py'
    }
  }
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
  beforeEach(() => {
    nock.cleanAll()
    nock.disableNetConnect()
  })

  afterEach(() => {
    mockFs.restore()
    if (!nock.isDone()) {
      throw new Error(`pending nock mocks: ${nock.pendingMocks()}`)
    }
  })

  describe('getPackageFilesForScan()', () => {
    it('should handle a "." inputPath', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['.'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`
      ])
    })

    it('should respect ignores from socket config', async () => {
      mockTestFs({
        [`${mockFixturePath}/bar/package-lock.json`]: '{}',
        [`${mockFixturePath}/bar/package.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        {
          version: 2,
          projectIgnorePaths: ['bar/*', '!bar/package.json'],
          issueRules: {},
          githubApp: {}
        }
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/bar/package.json`,
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`
      ])
    })

    it('should respect .gitignore', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'bar/*\n!bar/package.json',
        [`${mockFixturePath}/bar/package-lock.json`]: '{}',
        [`${mockFixturePath}/bar/package.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/bar/package.json`,
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`
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
        [`${mockFixturePath}/foo/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`
      ])
    })

    it('should ignore irrelevant matches', async () => {
      mockTestFs({
        [`${mockFixturePath}/foo/package-foo.json`]: '{}',
        [`${mockFixturePath}/foo/package-lock.json`]: '{}',
        [`${mockFixturePath}/foo/package.json`]: '{}',
        [`${mockFixturePath}/foo/random.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`
      ])
    })

    it('should be lenient on oddities', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: {
          /* Empty directory */
        }
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([])
    })

    it('should resolve package and lock file', async () => {
      mockTestFs({
        [`${mockFixturePath}/package-lock.json`]: '{}',
        [`${mockFixturePath}/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package-lock.json`,
        `${mockFixturePath}/package.json`
      ])
    })

    it('should resolve package without lock file', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`
      ])
    })

    it('should support alternative lock files', async () => {
      mockTestFs({
        [`${mockFixturePath}/yarn.lock`]: '{}',
        [`${mockFixturePath}/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`,
        `${mockFixturePath}/yarn.lock`
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
        [`${mockFixturePath}/abc/package.json`]: '{}'
      })

      const actual = await sortedGetPackageFilesFullScans(
        mockFixturePath,
        ['**/*'],
        globPatterns,
        undefined
      )
      expect(actual.map(normalizePath)).toEqual([
        `${mockFixturePath}/abc/package.json`,
        `${mockFixturePath}/bar/package.json`,
        `${mockFixturePath}/bar/yarn.lock`,
        `${mockFixturePath}/foo/package-lock.json`,
        `${mockFixturePath}/foo/package.json`,
        `${mockFixturePath}/package-lock.json`,
        `${mockFixturePath}/package.json`
      ])
    })
  })
})
