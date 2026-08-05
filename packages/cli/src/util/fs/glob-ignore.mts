/*
 * @file Gitignore pattern translation and the ancestor-chain ignore match.
 *   Split out of `glob.mts` so the glob walk keeps the discovery + streaming
 *   flow and this module keeps the pattern grammar: turning `.gitignore` lines
 *   into minimatch globs, and answering "is this path excluded" against the
 *   per-directory matcher chain.
 */

import path from 'node:path'

import type ignore from 'ignore'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export type IgnoreMatcher = ReturnType<typeof ignore>

export interface PathIgnoredByChainOptions {
  // Probe the path as a directory: appends a trailing slash so a
  // directory-only rule like `build/` matches it.
  isDir?: boolean | undefined
}

export function ignoreFileLinesToGlobPatterns(
  lines: string[] | readonly string[],
  filepath: string,
  cwd: string,
): string[] {
  const base = normalizePath(path.relative(cwd, path.dirname(filepath)))
  const patterns = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const pattern = lines[i]!.trim()
    if (pattern.length > 0 && pattern.charCodeAt(0) !== 35 /*'#'*/) {
      patterns.push(
        ignorePatternToMinimatch(
          pattern.length && pattern.charCodeAt(0) === 33 /*'!'*/
            ? `!${path.posix.join(base, pattern.slice(1))}`
            : path.posix.join(base, pattern),
        ),
      )
    }
  }
  return patterns
}

export function ignoreFileToGlobPatterns(
  content: string,
  filepath: string,
  cwd: string,
): string[] {
  return ignoreFileLinesToGlobPatterns(content.split(/\r?\n/), filepath, cwd)
}

// Based on `@eslint/compat` convertIgnorePatternToMinimatch.
// Apache v2.0 licensed
// Copyright Nicholas C. Zakas
// https://github.com/eslint/rewrite/blob/compat-v1.2.1/packages/compat/src/ignore-file.js#L28
export function ignorePatternToMinimatch(pattern: string): string {
  const isNegated = pattern.startsWith('!')
  const negatedPrefix = isNegated ? '!' : ''
  const patternToTest = (isNegated ? pattern.slice(1) : pattern).trimEnd()
  // Special cases.
  if (
    patternToTest === '' ||
    patternToTest === '**' ||
    patternToTest === '**' ||
    patternToTest === '/**'
  ) {
    return `${negatedPrefix}${patternToTest}`
  }
  const firstIndexOfSlash = patternToTest.indexOf('/')
  const matchEverywherePrefix =
    firstIndexOfSlash === -1 || firstIndexOfSlash === patternToTest.length - 1
      ? '**/'
      : ''
  const patternWithoutLeadingSlash =
    firstIndexOfSlash === 0 ? patternToTest.slice(1) : patternToTest
  // Escape `{` and `(` because in gitignore patterns they are just
  // literal characters without any specific syntactic meaning,
  // while in minimatch patterns they can form brace expansion or extglob syntax.
  //
  // For example, gitignore pattern `src/{a,b}.js` ignores file `src/{a,b}.js`.
  // But, the same minimatch pattern `src/{a,b}.js` ignores files `src/a.js` and `src/b.js`.
  // Minimatch pattern `src/\{a,b}.js` is equivalent to gitignore pattern `src/{a,b}.js`.
  const escapedPatternWithoutLeadingSlash =
    patternWithoutLeadingSlash.replaceAll(
      // socket-lint: allow regex-alternation-order -- `\\.` must come first so escape pairs are consumed atomically.
      /(?=((?:\\.|[^{(])*))\1([{(])/guy,
      '$1\\$2',
    )
  const matchInsideSuffix = patternToTest.endsWith('/**') ? '/*' : ''
  return `${negatedPrefix}${matchEverywherePrefix}${escapedPatternWithoutLeadingSlash}${matchInsideSuffix}`
}

// Whether `relPath` is ignored, honoring git's rule that an excluded directory
// is never descended into: a file is ignored if any ancestor directory is, and a
// deeper `!` cannot re-include a file under an excluded parent. Walks ancestors
// top-down, short-circuiting on the first excluded one. POSIX, relative to cwd.
export function isIgnoredAlongChain(
  relPath: string,
  matchersByDir: Map<string, IgnoreMatcher[]>,
): boolean {
  // Outside cwd (a `..` prefix) or empty: outside every gitignore's domain, and
  // the `ignore` package throws on such input, so report not-ignored.
  if (!relPath || relPath === '..' || relPath.startsWith('../')) {
    return false
  }
  const segments = normalizePath(relPath).split('/')
  const last = segments.length - 1
  let prefix = ''
  for (let i = 0; i <= last; i += 1) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!
    if (pathIgnoredByChain(prefix, matchersByDir, { isDir: i < last })) {
      return true
    }
  }
  return false
}

// Whether `targetPath` is ignored by the gitignore matchers on its ancestor
// directories, root to leaf, last match wins. Each matcher tests the path
// relative to its own directory, the form git stores its patterns in.
// `targetPath` is POSIX, relative to cwd.
export function pathIgnoredByChain(
  targetPath: string,
  matchersByDir: Map<string, IgnoreMatcher[]>,
  options?: PathIgnoredByChainOptions | undefined,
): boolean {
  const { isDir = false } = {
    __proto__: null,
    ...options,
  } as PathIgnoredByChainOptions
  let ignored = false
  // Ancestor directories of targetPath: '', then each parent dir prefix.
  const segments = normalizePath(targetPath).split('/')
  segments.pop()
  const dirs = ['']
  let prefix = ''
  for (let i = 0, { length } = segments; i < length; i += 1) {
    prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!
    dirs.push(prefix)
  }
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    const matchers = matchersByDir.get(dir)
    if (!matchers) {
      continue
    }
    const relToDir = dir === '' ? targetPath : targetPath.slice(dir.length + 1)
    const probe = isDir ? `${relToDir}/` : relToDir
    for (let j = 0, len = matchers.length; j < len; j += 1) {
      const result = matchers[j]!.test(probe)
      if (result.ignored) {
        ignored = true
      } else if (result.unignored) {
        ignored = false
      }
    }
  }
  return ignored
}

// fast-glob treats an `ignore` entry ending in `/` as a literal directory path
// rather than a glob and silently discards it. The gitignore convention of
// writing a directory entry as `dist/` reaches here as `**/dist/` after
// `ignorePatternToMinimatch`, so the whole ignore is dropped and fast-glob
// walks the subtree anyway. Strip the trailing slash so the pattern matches.
export function stripTrailingSlashFromIgnorePattern(pattern: string): string {
  if (
    pattern.length > 1 &&
    pattern.charCodeAt(pattern.length - 1) === 47 /*'/'*/
  ) {
    return pattern.slice(0, -1)
  }
  return pattern
}
