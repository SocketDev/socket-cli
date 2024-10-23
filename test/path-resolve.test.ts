import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import mockFs from 'mock-fs'
import nock from 'nock'

import {
  getPackageFiles,
  mapGlobEntryToFiles,
  mapGlobResultToFiles
} from './dist/path-resolve'

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

const sortedMapGlobEntry = sortedPromise(mapGlobEntryToFiles)

const sortedMapGlobResult = sortedPromise(mapGlobResultToFiles)

const sortedGetPackageFiles = sortedPromise(getPackageFiles)

describe('Path Resolve', () => {
  beforeEach(() => {
    nock.cleanAll()
    nock.disableNetConnect()
  })

  afterEach(() => {
    mockFs.restore()
    if (!nock.isDone()) {
      throw new Error('pending nock mocks: ' + nock.pendingMocks())
    }
  })

  describe('mapGlobEntryToFiles()', () => {
    describe('basic', () => {
      it('should skip irrelevant input', async () => {
        mockFs({
          '/foo.txt': 'some content'
        })
        assert.deepEqual(await sortedMapGlobEntry('/foo.txt', globPatterns), [])
      })

      it('should be lenient on oddities', async () => {
        mockFs({
          '/package.json': {
            /* Empty directory */
          }
        })
        await assert.deepEqual(await sortedMapGlobEntry('/', globPatterns), [])
      })
    })

    describe('from folder input', () => {
      it('should resolve package and lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
          '/package.json': '{}'
        })
        assert.deepEqual(await sortedMapGlobEntry('/', globPatterns), [
          '/package-lock.json',
          '/package.json'
        ])
      })

      it('should resolve package without lock file', async () => {
        mockFs({
          '/package.json': '{}'
        })
        assert.deepEqual(await sortedMapGlobEntry('/', globPatterns), [
          '/package.json'
        ])
      })

      it('should not resolve lock file without package', async () => {
        mockFs({
          '/package-lock.json': '{}'
        })
        assert.deepEqual(await sortedMapGlobEntry('/', globPatterns), [
          '/package-lock.json'
        ])
      })

      it('should support alternative lock files', async () => {
        mockFs({
          '/yarn.lock': '{}',
          '/package.json': '{}'
        })
        assert.deepEqual(await sortedMapGlobEntry('/', globPatterns), [
          '/package.json',
          '/yarn.lock'
        ])
      })
    })

    describe('from package file path', () => {
      it('should resolve package and lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
          '/package.json': '{}'
        })
        assert.deepEqual(
          await sortedMapGlobEntry('/package.json', globPatterns),
          ['/package-lock.json', '/package.json']
        )
      })

      it('should resolve package without lock file', async () => {
        mockFs({
          '/package.json': '{}'
        })
        assert.strict.deepEqual(
          await sortedMapGlobEntry('/package.json', globPatterns),
          ['/package.json']
        )
      })

      it('should validate the input file', async () => {
        mockFs({})
        return await (assert.rejects(
          sortedMapGlobEntry('/package.json', globPatterns),
          (e: any) => e instanceof Error && e.message.includes('ENOENT')
        ) as Promise<void>)
      })

      it('should support alternative lock files', async () => {
        mockFs({
          '/yarn.lock': '{}',
          '/package.json': '{}'
        })
        assert.deepEqual(
          await sortedMapGlobEntry('/package.json', globPatterns),
          ['/package.json', '/yarn.lock']
        )
      })
    })

    describe('from lock file path', () => {
      it('should resolve package and lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
          '/package.json': '{}'
        })
        assert.deepEqual(
          await sortedMapGlobEntry('/package-lock.json', globPatterns),
          ['/package-lock.json', '/package.json']
        )
      })

      it('should support alternative lock files', async () => {
        mockFs({
          '/yarn.lock': '{}',
          '/package.json': '{}'
        })
        assert.deepEqual(await sortedMapGlobEntry('/yarn.lock', globPatterns), [
          '/package.json',
          '/yarn.lock'
        ])
      })
    })
  })

  describe('mapGlobResultToFiles()', () => {
    it('should handle all variations', async () => {
      mockFs({
        '/package-lock.json': '{}',
        '/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
        '/bar/yarn.lock': '{}',
        '/bar/package.json': '{}',
        '/abc/package.json': '{}'
      })

      assert.deepEqual(
        await sortedMapGlobResult(
          [
            '/',
            '/foo/package-lock.json',
            '/bar/package.json',
            '/abc/',
            '/abc/package.json'
          ],
          globPatterns
        ),
        [
          '/abc/package.json',
          '/bar/package.json',
          '/bar/yarn.lock',
          '/foo/package-lock.json',
          '/foo/package.json',
          '/package-lock.json',
          '/package.json'
        ]
      )
    })
  })

  describe('getPackageFiles()', () => {
    it('should handle all variations', async () => {
      mockFs({
        '/package-lock.json': '{}',
        '/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
        '/bar/yarn.lock': '{}',
        '/bar/package.json': '{}',
        '/abc/package.json': '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          '/',
          ['**/*'],
          undefined,
          globPatterns,
          () => {}
        ),
        [
          '/abc/package.json',
          '/bar/package.json',
          '/bar/yarn.lock',
          '/foo/package-lock.json',
          '/foo/package.json',
          '/package-lock.json',
          '/package.json'
        ]
      )
    })

    it('should handle a "." inputPath', async () => {
      mockFs({
        '/package.json': '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          '/',
          ['.'],
          undefined,
          globPatterns,
          () => {}
        ),
        ['/package.json']
      )
    })

    it('should respect ignores from socket config', async () => {
      mockFs({
        '/bar/package-lock.json': '{}',
        '/bar/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          '/',
          ['**/*'],
          {
            version: 2,
            projectIgnorePaths: ['/bar/*', '!/bar/package.json'],
            issueRules: {},
            githubApp: {}
          },
          globPatterns,
          () => {}
        ),
        ['/bar/package.json', '/foo/package-lock.json', '/foo/package.json']
      )
    })

    it('should respect .gitignore', async () => {
      mockFs({
        '/.gitignore': '/bar\n!/bar/package.json',
        '/bar/package-lock.json': '{}',
        '/bar/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          '/',
          ['**/*'],
          undefined,
          globPatterns,
          () => {}
        ),
        ['/foo/package-lock.json', '/foo/package.json']
      )
    })

    it('should always ignore some paths', async () => {
      mockFs({
        // Mirrors the used list form https://github.com/novemberborn/ignore-by-default
        '/.git/some/dir/package.json': {},
        '/.log/some/dir/package.json': {},
        '/.nyc_output/some/dir/package.json': {},
        '/.sass-cache/some/dir/package.json': {},
        '/.yarn/some/dir/package.json': {},
        '/bower_components/some/dir/package.json': {},
        '/coverage/some/dir/package.json': {},
        '/node_modules/socket/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          '/',
          ['**/*'],
          undefined,
          globPatterns,
          () => {}
        ),
        ['/foo/package-lock.json', '/foo/package.json']
      )
    })

    it('should ignore irrelevant matches', async () => {
      mockFs({
        '/foo/package-foo.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
        '/foo/random.json': '{}'
      })

      assert.deepEqual(
        await sortedGetPackageFiles(
          '/',
          ['**/*'],
          undefined,
          globPatterns,
          () => {}
        ),
        ['/foo/package-lock.json', '/foo/package.json']
      )
    })
  })
})
