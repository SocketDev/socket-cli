/// <reference types="mocha" />
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import mockFs from 'mock-fs'
import nock from 'nock'

import { InputError } from '../lib/utils/errors.js'
import {
  fileExists,
  getPackageFiles,
  mapGlobEntryToFiles,
  mapGlobResultToFiles,
} from '../lib/utils/path-resolve.js'

chai.use(chaiAsPromised)
chai.should()

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

  describe('fileExists()', () => {
    beforeEach(() => {
      mockFs({
        'foo.txt': 'some content',
        'some-dir': { /* Empty directory */ },
      })
    })

    it('should handle found files', async () => {
      await fileExists('foo.txt').should.eventually.be.true
    })

    it('should handle missing files', async () => {
      await fileExists('missing.txt').should.eventually.be.false
    })

    it('should throw when finding a folder', async () => {
      await fileExists('some-dir')
        .should.be.rejectedWith(InputError, 'Expected \'some-dir\' to be a file')
    })
  })

  describe('mapGlobEntryToFiles()', () => {
    describe('basic', () => {
      it('should skip irrelevant input', async () => {
        mockFs({
          '/foo.txt': 'some content',
        })
        await mapGlobEntryToFiles('/foo.txt').should.eventually.become([])
      })

      it('should throw on errors', async () => {
        mockFs({
          '/package.json': { /* Empty directory */ },
        })
        await mapGlobEntryToFiles('/')
          .should.eventually.be.rejectedWith(InputError, 'Expected \'/package.json\' to be a file')
      })
    })

    describe('from folder input', () => {
      it('should resolve package and lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/').should.eventually.become([
          '/package.json',
          '/package-lock.json'
        ])
      })

      it('should resolve package without lock file', async () => {
        mockFs({
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/').should.eventually.become(['/package.json'])
      })

      it('should not resolve lock file without package', async () => {
        mockFs({
          '/package-lock.json': '{}',
        })
        await mapGlobEntryToFiles('/').should.eventually.become([])
      })

      it('should support alternative lock files', async () => {
        mockFs({
          '/yarn.lock': '{}',
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/').should.eventually.become([
          '/package.json',
          '/yarn.lock'
        ])
      })
    })

    describe('from package file path', () => {
      it('should resolve package and lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/package.json').should.eventually.become([
          '/package.json',
          '/package-lock.json'
        ])
      })

      it('should resolve package without lock file', async () => {
        mockFs({
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/package.json').should.eventually.become(['/package.json'])
      })

      it('should not validate the input file', async () => {
        mockFs({})
        await mapGlobEntryToFiles('/package.json').should.eventually.become(['/package.json'])
      })

      it('should not validate the input file, but still add a complementary lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
        })
        await mapGlobEntryToFiles('/package.json').should.eventually.become([
          '/package.json',
          '/package-lock.json'
        ])
      })

      it('should support alternative lock files', async () => {
        mockFs({
          '/yarn.lock': '{}',
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/package.json').should.eventually.become([
          '/package.json',
          '/yarn.lock'
        ])
      })
    })

    describe('from lock file path', () => {
      it('should resolve package and lock file', async () => {
        mockFs({
          '/package-lock.json': '{}',
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/package-lock.json').should.eventually.become([
          '/package.json',
          '/package-lock.json'
        ])
      })

      it('should assume input is correct and paired with package file', async () => {
        mockFs({})
        await mapGlobEntryToFiles('/package-lock.json').should.eventually.become([
          '/package.json',
          '/package-lock.json'
        ])
      })

      it('should support alternative lock files', async () => {
        mockFs({
          '/yarn.lock': '{}',
          '/package.json': '{}',
        })
        await mapGlobEntryToFiles('/yarn.lock').should.eventually.become([
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
        '/abc/package.json': '{}',
      })

      await mapGlobResultToFiles([
        '/',
        '/foo/package-lock.json',
        '/bar/package.json',
        '/abc/',
        '/abc/package.json'
      ]).should.eventually.become([
        '/package.json',
        '/package-lock.json',
        '/foo/package.json',
        '/foo/package-lock.json',
        '/bar/package.json',
        '/bar/yarn.lock',
        '/abc/package.json',
      ])
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
        '/abc/package.json': '{}',
      })

      await getPackageFiles(
        '/',
        ['**/*'],
        undefined,
        () => {}
      ).should.eventually.become([
        '/abc/package.json',
        '/bar/package.json',
        '/bar/yarn.lock',
        '/foo/package.json',
        '/foo/package-lock.json',
        '/package.json',
        '/package-lock.json',
      ])
    })

    it('should handle a "." inputPath', async () => {
      mockFs({
        '/package.json': '{}',
      })

      await getPackageFiles(
        '/',
        ['.'],
        undefined,
        () => {}
      ).should.eventually.become([
        '/package.json',
      ])
    })

    it('should respect ignores from socket config', async () => {
      mockFs({
        '/bar/package-lock.json': '{}',
        '/bar/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
      })

      await getPackageFiles(
        '/',
        ['**/*'],
        {
          version: 2,
          projectIgnorePaths: [
            '/bar/*',
            '!/bar/package.json',
          ],
          issueRules: {},
          githubApp: {}
        },
        () => {}
      ).should.eventually.become([
        '/bar/package.json',
        '/foo/package.json',
        '/foo/package-lock.json',
      ])
    })

    it('should respect .gitignore', async () => {
      mockFs({
        '/.gitignore': '/bar\n!/bar/package.json',
        '/bar/package-lock.json': '{}',
        '/bar/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
      })

      await getPackageFiles(
        '/',
        ['**/*'],
        undefined,
        () => {}
      ).should.eventually.become([
        '/foo/package.json',
        '/foo/package-lock.json',
      ])
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
        '/node_modules/@socketsecurity/cli/package.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
      })

      await getPackageFiles(
        '/',
        ['**/*'],
        undefined,
        () => {}
      ).should.eventually.become([
        '/foo/package.json',
        '/foo/package-lock.json',
      ])
    })

    it('should ignore irrelevant matches', async () => {
      mockFs({
        '/foo/package-foo.json': '{}',
        '/foo/package-lock.json': '{}',
        '/foo/package.json': '{}',
        '/foo/random.json': '{}',
      })

      await getPackageFiles(
        '/',
        ['**/*'],
        undefined,
        () => {}
      ).should.eventually.become([
        '/foo/package.json',
        '/foo/package-lock.json',
      ])
    })
  })
})
