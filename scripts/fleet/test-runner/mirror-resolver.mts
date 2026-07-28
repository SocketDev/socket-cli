/* eslint-disable no-shadow -- nested cached-length for-loops intentionally reuse `i`/`length` names for the fleet-wide cached-loop idiom; renaming would diverge from the codebase pattern. */
/**
 * @file The MIRROR test resolver for the fleet test runner
 *   (scripts/fleet/test.mts): given a staged/changed source file, find the test
 *   files that mirror it — bare basename tests, shard tests that import it,
 *   check-by-name tests, and any direct-importer test. Never uses `vitest
 *   related`; stays bounded to `test/` trees. Indexed once per repo so a staged
 *   run resolving many sources is O(tests + sources), not O(tests × sources).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  firstPartyImports,
  isCheckByName,
} from '../check/tests-are-mirror-named.mts'
import { gitFiles } from './git-files.mts'

// The test-file glob patterns, one pattern each for .mts/.ts/.mjs/.cjs/.js/.tsx/.jsx.
export const TEST_EXTENSIONS = '{mts,ts,mjs,cjs,js,tsx,jsx}'

// A path that IS a test file, vitest's default test-file shape.
export function isTestFile(filePath: string): boolean {
  return /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(filePath)
}

// The mirror test(s) of a SOURCE file, found by the MIRROR resolver (not by
// vitest related). The finder receives the repo-relative source path and returns
// the repo-relative test paths that mirror it. `finder` is injected so the
// resolver is unit-tested without a filesystem.
export function mirrorTestsFor(
  sourcePath: string,
  finder: (sourcePath: string) => readonly string[],
): string[] {
  if (!sourcePath) {
    return []
  }
  return [...finder(sourcePath)]
}

// Build the NARROWED staged test set: staged test files run directly, plus each
// staged source file's mirror test(s) from the MIRROR resolver. Untracked paths
// are dropped so a foreign, mid-write test another live actor hasn't committed
// can't gate this commit. Pure (inputs + finder injected) so the scope rule is
// unit-tested without spawning vitest or touching the filesystem.
export function buildStagedTestFiles(
  stagedFiles: readonly string[],
  untrackedFiles: readonly string[],
  finder: (sourcePath: string) => readonly string[],
): string[] {
  const untracked = new Set(untrackedFiles)
  const out = new Set<string>()
  for (const f of stagedFiles) {
    if (isTestFile(f)) {
      out.add(f)
      continue
    }
    for (const t of mirrorTestsFor(f, finder)) {
      out.add(t)
    }
  }
  for (const u of untracked) {
    out.delete(u)
  }
  return [...out]
}

interface MirrorTestIndex {
  readonly importersBySource: ReadonlyMap<string, readonly string[]>
  readonly testFiles: readonly string[]
}

// A staged run may resolve mirrors for many source files. Index each repo's
// test tree once so that cost is O(tests + sources), not O(tests × sources).
const mirrorTestIndexCache = new Map<string, MirrorTestIndex>()

function mirrorTestIndex(root: string): MirrorTestIndex {
  const resolvedRoot = path.resolve(root)
  const cached = mirrorTestIndexCache.get(resolvedRoot)
  if (cached) {
    return cached
  }
  const tracked = gitFiles(['ls-files'], resolvedRoot)
  // Git is the fast and exact index for a real checkout: it omits ignored
  // output and submodule contents. A non-git fixture falls back to the glob.
  const testFiles = tracked.length
    ? tracked.filter(
        file => /(?:^|\/)test\//.test(normalizePath(file)) && isTestFile(file),
      )
    : globSync(
        [
          `**/test/**/*.test.${TEST_EXTENSIONS}`,
          `**/test/**/*.spec.${TEST_EXTENSIONS}`,
        ],
        {
          cwd: resolvedRoot,
          absolute: false,
          ignore: ['**/node_modules/**'],
        },
      )
  const importersBySource = new Map<string, string[]>()
  for (let i = 0, { length } = testFiles; i < length; i += 1) {
    const rel = testFiles[i]!
    const abs = path.join(resolvedRoot, rel)
    let content = ''
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const imports = firstPartyImports(content, path.dirname(abs), resolvedRoot)
    for (let j = 0, { length } = imports; j < length; j += 1) {
      const source = imports[j]!
      const importers = importersBySource.get(source)
      if (importers) {
        importers.push(rel)
      } else {
        importersBySource.set(source, [rel])
      }
    }
  }
  const index = { importersBySource, testFiles }
  mirrorTestIndexCache.set(resolvedRoot, index)
  return index
}

// Find a source file's mirror test files by the MIRROR resolver:
//   (1) `**/test/**/<base>.test.*` — bare basename match
//   (2) direct importers named `**/test/**/<base>-*.test.*` — shard tests
//       (e.g. cover-thresholds for cover.mts); requiring the import prevents a
//       generic source such as test.mts from claiming unrelated test-* specs
//   (3) `**/test/**/check-<base>.test.*` — check-by-name tests, only when
//       a `scripts/.../check/<base>.mts` enforcer exists (isCheckByName)
//   (4) any test file under a `test/` tree whose first-party imports include this
//       source (direct importers — the accurate catch for not-yet-renamed tests)
//
// Never uses `vitest related`; stays bounded to test/ trees only. `**/`-anchored
// (not root-anchored `test/**`) so a monorepo's nested `packages/<name>/test/`
// mirrors resolve the same as a single-package repo's root `test/` — the same
// fix as the vitest config's `include` (see .config/repo/vitest.config.mts).
export function findMirrorTests(sourcePath: string, root: string): string[] {
  const base = path.basename(sourcePath).replace(/\.[cm]?[jt]sx?$/, '')
  if (!base) {
    return []
  }
  const out = new Set<string>()
  const index = mirrorTestIndex(root)
  const checkBase = `check-${base}`
  const acceptsCheckName = isCheckByName(checkBase, root)
  const importers = index.importersBySource.get(sourcePath) ?? []
  const importerSet = new Set(importers)
  for (let i = 0, { length } = index.testFiles; i < length; i += 1) {
    const rel = index.testFiles[i]!
    if (!/\.test\.[cm]?[jt]sx?$/.test(rel)) {
      continue
    }
    const testBase = path.basename(rel).replace(/\.test\.[cm]?[jt]sx?$/, '')
    if (
      testBase === base ||
      (testBase.startsWith(`${base}-`) && importerSet.has(rel)) ||
      (acceptsCheckName && testBase === checkBase)
    ) {
      out.add(rel)
    }
  }
  for (let i = 0, { length } = importers; i < length; i += 1) {
    out.add(importers[i]!)
  }
  return [...out].toSorted()
}
