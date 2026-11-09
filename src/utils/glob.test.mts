import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import {
  createSupportedFilesFilter,
  globWithGitIgnore,
  pathsToGlobPatterns,
} from './glob.mts'

// Filter functions defined at module scope to satisfy linting rules.
function filterJsonFiles(filepath: string): boolean {
  return filepath.endsWith('.json')
}

function filterTsFiles(filepath: string): boolean {
  return filepath.endsWith('.ts')
}

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

describe('glob utilities', () => {
  afterEach(() => {
    rmSync(mockFixturePath, { recursive: true, force: true })
  })

  beforeEach(() => {
    mockFixturePath = normalizePath(
      mkdtempSync(path.join(os.tmpdir(), 'glob-test-')),
    )
  })

  describe('globWithGitIgnore()', () => {
    it('should find files matching glob patterns', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/src/index.ts`]: '',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath)).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should respect .gitignore files', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'ignored/**',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/ignored/package.json`]: '{}',
        [`${mockFixturePath}/included/package.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/included/package.json`,
        `${mockFixturePath}/package.json`,
      ])
    })

    it('treats gitignore braces and parentheses literally', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'literal{a,b}.txt\nliteral(a).txt',
        [`${mockFixturePath}/literal{a,b}.txt`]: '',
        [`${mockFixturePath}/literal(a).txt`]: '',
        [`${mockFixturePath}/literal-a.txt`]: '',
      })

      const results = await globWithGitIgnore(['**/*.txt'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/literal-a.txt`,
      ])
    })

    it('should handle negated patterns in .gitignore', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'ignored/**\n!ignored/keep.json',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/ignored/excluded.json`]: '{}',
        [`${mockFixturePath}/ignored/keep.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      // The negated pattern should allow keep.json to be included.
      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/ignored/keep.json`,
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should apply filter function during streaming to reduce memory', async () => {
      // Create a mock filesystem with many files.
      const files: Record<string, unknown> = {}
      const fileCount = 100
      for (let i = 0; i < fileCount; i += 1) {
        files[`${mockFixturePath}/file${i}.txt`] = 'content'
        files[`${mockFixturePath}/file${i}.json`] = '{}'
      }
      // Add a gitignore with negated pattern to trigger the streaming path.
      files[`${mockFixturePath}/.gitignore`] = 'temp/\n!temp/keep.json'
      mockTestFs(files)

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterJsonFiles,
      })

      // Should only include .json files (100 files).
      expect(results).toHaveLength(fileCount)
      for (const result of results) {
        expect(result.endsWith('.json')).toBe(true)
      }
    })

    it('should apply filter without negated patterns', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/src/index.ts`]: '',
        [`${mockFixturePath}/src/utils.ts`]: '',
        [`${mockFixturePath}/readme.md`]: '',
      })

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterTsFiles,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/src/index.ts`,
        `${mockFixturePath}/src/utils.ts`,
      ])
    })

    it('should skip directories ignored via trailing-slash patterns', async () => {
      // fast-glob silently drops `ignore` entries that end in `/`, so
      // the pattern produced for `dist/` (`**/dist/`) used to do
      // nothing at the walk level and dist contents leaked through.
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'dist/\n',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/dist/a.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('keeps additionalIgnores anchored even when a gitignore negation forces the streaming path', async () => {
      // A bare `tests` pattern means "the entry `tests` at the scan root".
      // The streaming path uses the `ignore` package for gitignore-translated
      // entries, which treats bare names as match-anywhere. CLI patterns
      // must bypass that matcher so anchored semantics survive.
      mockTestFs({
        // `!nested/keep.json` forces hasNegatedPattern = true → streaming.
        [`${mockFixturePath}/.gitignore`]: 'banned/**\n!nested/keep.json',
        [`${mockFixturePath}/tests/foo.json`]: '{}',
        [`${mockFixturePath}/subdir/tests/foo.json`]: '{}',
        [`${mockFixturePath}/nested/keep.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        additionalIgnores: ['tests', 'tests/**'],
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/nested/keep.json`,
        `${mockFixturePath}/subdir/tests/foo.json`,
      ])
    })

    it('excludes direct-child files when user writes `--exclude-paths packages/*`', async () => {
      // Anchored micromatch semantics: `packages/*` matches every direct
      // child of packages/ — both files like packages/stray.json and dirs
      // like packages/a. The user-facing help text promises anchored
      // micromatch, so all four manifest files below should be excluded
      // from the scan, leaving only the top-level package.json.
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/packages/stray.json`]: '{}',
        [`${mockFixturePath}/packages/package.json`]: '{}',
        [`${mockFixturePath}/packages/a/package.json`]: '{}',
        [`${mockFixturePath}/packages/b/package.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        additionalIgnores: ['packages/*', 'packages/*/**'],
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('should combine filter with negated gitignore patterns', async () => {
      mockTestFs({
        [`${mockFixturePath}/.gitignore`]: 'build/**\n!build/manifest.json',
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/src/index.ts`]: '',
        [`${mockFixturePath}/build/output.js`]: '',
        [`${mockFixturePath}/build/manifest.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterJsonFiles,
      })

      // Should include package.json and the negated build/manifest.json, but not build/output.js.
      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/build/manifest.json`,
        `${mockFixturePath}/package.json`,
      ])
    })

    // Reproduces the reported `socket fix` crash: a project containing a
    // directory the running user cannot enter (e.g. a postgres `pgdata` dir
    // owned by another uid, mode drwx------) made fast-glob throw
    // `EACCES: permission denied, scandir` during manifest discovery. Uses the
    // real filesystem because mock-fs only enforces permissions for non-root
    // uids; skipped under root (perm checks bypassed) and on Windows (no POSIX
    // directory perms).
    const skipUnreadableDirTest =
      process.platform === 'win32' ||
      (typeof process.getuid === 'function' && process.getuid() === 0)
    it.skipIf(skipUnreadableDirTest)(
      'skips an unreadable directory instead of throwing EACCES',
      async () => {
        const realTmp = mkdtempSync(path.join(os.tmpdir(), 'socket-glob-perm-'))
        const unreadable = path.join(realTmp, 'data/postgres/pgdata')
        try {
          mkdirSync(unreadable, { recursive: true })
          writeFileSync(path.join(realTmp, 'package.json'), '{}')
          // Files inside the directory must never surface — the user cannot
          // read them, so they cannot be scanned.
          writeFileSync(path.join(unreadable, 'PG_VERSION'), '17')
          // drwx------ : owner-only, and the running test user is not the owner
          // in the field report; locally dropping all bits has the same effect
          // of making scandir fail for the current user.
          chmodSync(unreadable, 0o000)

          const results = await globWithGitIgnore(['**/*'], {
            cwd: realTmp,
          })

          expect(results.map(normalizePath)).toEqual([
            normalizePath(path.join(realTmp, 'package.json')),
          ])
        } finally {
          // Restore perms so recursive cleanup can descend into the locked dir.
          try {
            chmodSync(unreadable, 0o755)
          } catch {}
          rmSync(realTmp, { force: true, recursive: true })
        }
      },
    )

    it('excludes a Python virtual environment detected via pyvenv.cfg', async () => {
      // A venv can use any directory name; the reliable signal is the
      // pyvenv.cfg marker at its root. Manifests inside it must not surface.
      mockTestFs({
        [`${mockFixturePath}/requirements.txt`]: '',
        [`${mockFixturePath}/myenv/pyvenv.cfg`]:
          'home = /usr/bin\nversion = 3.11.0\n',
        [`${mockFixturePath}/myenv/requirements.txt`]: '',
        [`${mockFixturePath}/myenv/lib/python3.11/site-packages/foo/setup.py`]:
          '',
      })

      const results = await globWithGitIgnore(
        ['**/requirements.txt', '**/setup.py'],
        { cwd: mockFixturePath },
      )

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/requirements.txt`,
      ])
    })

    it('excludes a `.venv` directory by name', async () => {
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/.venv/lib/site-packages/foo/package.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })

    it('keeps a non-venv directory named `venv` without a pyvenv.cfg', async () => {
      // Guards against over-exclusion: a bare `venv` dir is only skipped when
      // it actually contains a pyvenv.cfg, never by name alone.
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/venv/package.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*.json'], {
        cwd: mockFixturePath,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/package.json`,
        `${mockFixturePath}/venv/package.json`,
      ])
    })

    it('excludes a venv via pyvenv.cfg through the streaming filter path', async () => {
      // The actual manifest-scan path always passes a filter, so verify the
      // venv exclusion prunes there too.
      mockTestFs({
        [`${mockFixturePath}/package.json`]: '{}',
        [`${mockFixturePath}/env/pyvenv.cfg`]: 'home = /usr/bin\n',
        [`${mockFixturePath}/env/lib/site-packages/bar/package.json`]: '{}',
      })

      const results = await globWithGitIgnore(['**/*'], {
        cwd: mockFixturePath,
        filter: filterJsonFiles,
      })

      expect(results.map(normalizePath).sort()).toEqual([
        `${mockFixturePath}/package.json`,
      ])
    })
  })

  describe('createSupportedFilesFilter()', () => {
    it('should create a filter function matching supported file patterns', () => {
      const supportedFiles = {
        npm: {
          packagejson: { pattern: 'package.json' },
          packagelockjson: { pattern: 'package-lock.json' },
        },
      }

      const filter = createSupportedFilesFilter(supportedFiles)

      expect(filter('/path/to/package.json')).toBe(true)
      expect(filter('/path/to/package-lock.json')).toBe(true)
      expect(filter('/path/to/random.txt')).toBe(false)
      expect(filter('/path/to/nested/package.json')).toBe(true)
    })
  })

  describe('pathsToGlobPatterns()', () => {
    it('should convert "." to "**/*"', () => {
      expect(pathsToGlobPatterns(['.'])).toEqual(['**/*'])
      expect(pathsToGlobPatterns(['./'])).toEqual(['**/*'])
    })

    it('should append "/**/*" to directory paths', () => {
      mockTestFs({
        [`${mockFixturePath}/subdir`]: {
          'file.txt': '',
        },
      })

      // The function checks if path is a directory using isDirSync.
      const result = pathsToGlobPatterns(['subdir'], mockFixturePath)
      expect(result).toEqual(['subdir/**/*'])
    })

    it('should keep file paths unchanged', () => {
      mockTestFs({
        [`${mockFixturePath}/file.txt`]: '',
      })

      const result = pathsToGlobPatterns(['file.txt'], mockFixturePath)
      expect(result).toEqual(['file.txt'])
    })
  })
})
