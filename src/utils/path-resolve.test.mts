import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import {
  PACKAGE_JSON,
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  YARN_LOCK,
} from '../constants.mjs'
import { getPackageFilesForScan } from './path-resolve.mts'

let mockFixturePath = ''

function mockTestFs(config: Record<string, unknown>): void {
  const writeEntry = (filename: string, value: unknown): void => {
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      mkdirSync(filename, { recursive: true })
      for (const [name, child] of Object.entries(value)) {
        writeEntry(path.join(filename, name), child)
      }
      return
    }
    mkdirSync(path.dirname(filename), { recursive: true })
    writeFileSync(filename, value as string | Uint8Array)
  }
  for (const [filename, value] of Object.entries(config)) {
    writeEntry(filename, value)
  }
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
    rmSync(mockFixturePath, { recursive: true, force: true })
  })

  beforeEach(() => {
    mockFixturePath = normalizePath(
      mkdtempSync(path.join(os.tmpdir(), 'path-resolve-test-')),
    )
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

    it('should keep scan-root ignores effective when the input path is absolute', async () => {
      const appDirPath = normalizePath(path.join(mockFixturePath, 'apps/api'))
      mockTestFs({
        [`${appDirPath}/package.json`]: '{}',
        [`${appDirPath}/src/package.json`]: '{}',
        [`${appDirPath}/tests/package.json`]: '{}',
      })

      const actual = await sortedGetPackageFilesFullScans(
        [appDirPath],
        globPatterns,
        {
          additionalIgnores: ['apps/api/tests', 'apps/api/tests/**'],
          cwd: mockFixturePath,
        },
      )

      expect(actual.map(normalizePath)).toEqual([
        `${appDirPath}/package.json`,
        `${appDirPath}/src/package.json`,
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

    // The supported-file patterns from the SDK are lowercase (e.g. 'pipfile'),
    // but real Python projects often use capitalized filenames such as
    // `Pipfile` and `Pipfile.lock`. Pattern matching must be case-insensitive
    // so those files are not silently dropped from the scan.
    describe('case-insensitive manifest matching', () => {
      const pythonPatterns = {
        npm: {
          packagejson: { pattern: PACKAGE_JSON },
        },
        pypi: {
          pipfile: { pattern: 'pipfile' },
          pipfilelock: { pattern: 'pipfile.lock' },
          pyproject: { pattern: 'pyproject.toml' },
          requirements: {
            pattern:
              '{*requirements.txt,requirements/*.txt,requirements-*.txt,requirements.frozen}',
          },
          setuppy: { pattern: 'setup.py' },
          uvlock: { pattern: 'uv.lock' },
        },
      }

      const sortedGetPythonFiles = sortedPromise(getPackageFilesForScan)

      it('picks up canonical Pipfile and Pipfile.lock (uppercase P)', async () => {
        mockTestFs({
          [`${mockFixturePath}/project-pipfile/Pipfile`]: '',
          [`${mockFixturePath}/project-pipfilelock/Pipfile.lock`]: '{}',
        })

        const actual = await sortedGetPythonFiles(['**/*'], pythonPatterns, {
          cwd: mockFixturePath,
        })
        expect(actual.map(normalizePath)).toEqual([
          `${mockFixturePath}/project-pipfile/Pipfile`,
          `${mockFixturePath}/project-pipfilelock/Pipfile.lock`,
        ])
      })

      it('picks up every Python sibling project in a mixed-format root', async () => {
        mockTestFs({
          [`${mockFixturePath}/project-a/pyproject.toml`]: '',
          [`${mockFixturePath}/project-a/uv.lock`]: '',
          [`${mockFixturePath}/project-a/src/main.py`]: '',
          [`${mockFixturePath}/project-b/requirements.txt`]: '',
          [`${mockFixturePath}/project-b/src/main.py`]: '',
        })

        const actual = await sortedGetPythonFiles(['**/*'], pythonPatterns, {
          cwd: mockFixturePath,
        })
        expect(actual.map(normalizePath)).toEqual([
          `${mockFixturePath}/project-a/pyproject.toml`,
          `${mockFixturePath}/project-a/uv.lock`,
          `${mockFixturePath}/project-b/requirements.txt`,
        ])
      })
    })
  })
})
