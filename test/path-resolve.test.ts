import assert from 'node:assert/strict'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import mockFs from 'mock-fs'
import nock from 'nock'

import { getPackageFiles } from './dist/path-resolve'

const testPath = __dirname
const rootPath = path.resolve(__dirname, '..')
const mockPath = path.join(testPath, 'mock')

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
const sortedGetPackageFiles = sortedPromise(getPackageFiles)

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

  describe('getPackageFiles()', () => {
    it('should handle a "." inputPath', async () => {
      mockFs({
        [`${mockPath}/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(mockPath, ['.'], undefined, globPatterns),
        [`${mockPath}/package.json`]
      )
    })

    it('should respect ignores from socket config', async () => {
      mockFs({
        [`${mockPath}/bar/package-lock.json`]: '{}',
        [`${mockPath}/bar/package.json`]: '{}',
        [`${mockPath}/foo/package-lock.json`]: '{}',
        [`${mockPath}/foo/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          {
            version: 2,
            projectIgnorePaths: ['bar/*', '!bar/package.json'],
            issueRules: {},
            githubApp: {}
          },
          globPatterns
        ),
        [
          `${mockPath}/bar/package.json`,
          `${mockPath}/foo/package-lock.json`,
          `${mockPath}/foo/package.json`
        ]
      )
    })

    it('should respect .gitignore', async () => {
      mockFs({
        [`${mockPath}/.gitignore`]: 'bar/*\n!bar/package.json',
        [`${mockPath}/bar/package-lock.json`]: '{}',
        [`${mockPath}/bar/package.json`]: '{}',
        [`${mockPath}/foo/package-lock.json`]: '{}',
        [`${mockPath}/foo/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [
          `${mockPath}/bar/package.json`,
          `${mockPath}/foo/package-lock.json`,
          `${mockPath}/foo/package.json`
        ]
      )
    })

    it('should always ignore some paths', async () => {
      mockFs({
        // Mirrors the list from
        // https://github.com/novemberborn/ignore-by-default/blob/v2.1.0/index.js
        [`${mockPath}/.git/some/dir/package.json`]: '{}',
        [`${mockPath}/.log/some/dir/package.json`]: '{}',
        [`${mockPath}/.nyc_output/some/dir/package.json`]: '{}',
        [`${mockPath}/.sass-cache/some/dir/package.json`]: '{}',
        [`${mockPath}/.yarn/some/dir/package.json`]: '{}',
        [`${mockPath}/bower_components/some/dir/package.json`]: '{}',
        [`${mockPath}/coverage/some/dir/package.json`]: '{}',
        [`${mockPath}/node_modules/socket/package.json`]: '{}',
        [`${mockPath}/foo/package-lock.json`]: '{}',
        [`${mockPath}/foo/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [`${mockPath}/foo/package-lock.json`, `${mockPath}/foo/package.json`]
      )
    })

    it('should ignore irrelevant matches', async () => {
      mockFs({
        [`${mockPath}/foo/package-foo.json`]: '{}',
        [`${mockPath}/foo/package-lock.json`]: '{}',
        [`${mockPath}/foo/package.json`]: '{}',
        [`${mockPath}/foo/random.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [`${mockPath}/foo/package-lock.json`, `${mockPath}/foo/package.json`]
      )
    })

    it('should be lenient on oddities', async () => {
      mockFs({
        [`${mockPath}/package.json`]: {
          /* Empty directory */
        }
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        []
      )
    })

    it('should resolve package and lock file', async () => {
      mockFs({
        [`${mockPath}/package-lock.json`]: '{}',
        [`${mockPath}/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [`${mockPath}/package-lock.json`, `${mockPath}/package.json`]
      )
    })

    it('should resolve package without lock file', async () => {
      mockFs({
        [`${mockPath}/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [`${mockPath}/package.json`]
      )
    })

    it('should support alternative lock files', async () => {
      mockFs({
        [`${mockPath}/yarn.lock`]: '{}',
        [`${mockPath}/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [`${mockPath}/package.json`, `${mockPath}/yarn.lock`]
      )
    })

    it('should handle all variations', async () => {
      mockFs({
        [`${mockPath}/package-lock.json`]: '{}',
        [`${mockPath}/package.json`]: '{}',
        [`${mockPath}/foo/package-lock.json`]: '{}',
        [`${mockPath}/foo/package.json`]: '{}',
        [`${mockPath}/bar/yarn.lock`]: '{}',
        [`${mockPath}/bar/package.json`]: '{}',
        [`${mockPath}/abc/package.json`]: '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          mockPath,
          ['**/*'],
          undefined,
          globPatterns
        ),
        [
          `${mockPath}/abc/package.json`,
          `${mockPath}/bar/package.json`,
          `${mockPath}/bar/yarn.lock`,
          `${mockPath}/foo/package-lock.json`,
          `${mockPath}/foo/package.json`,
          `${mockPath}/package-lock.json`,
          `${mockPath}/package.json`
        ]
      )
    })
  })
})
