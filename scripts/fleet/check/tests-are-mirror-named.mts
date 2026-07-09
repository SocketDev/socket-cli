#!/usr/bin/env node
/*
 * @file `check --all` gate: every unit test file mirrors the ONE source it
 *   tests. The convention (derived from a fleet-wide audit):
 *
 *   - **Dir-scoped mirror** — a test at `test/<category>/<subpath>/<name>.test.mts`
 *     tests the source whose basename is `<name>`, matched by the test's FIRST-
 *     party static import (not by filename guessing). Same basename = conforming.
 *   - **Detection by direct import** — resolve each test's repo-relative
 *     first-party imports (its own `src/` / `scripts/`, never node_modules or a
 *     sibling repo). ZERO first-party imports → exempt (integration / e2e /
 *     fixture / smoke). ONE → must mirror that source's basename. TWO OR MORE →
 *     must SPLIT into one test file per source.
 *   - **Two blessed off-basename variants** — `check-<name>.test.mts` for a
 *     `scripts/.../check/<name>.mts` enforcer, and `<dir>.test.mts` for a
 *     hook / lint-rule whose unit IS its directory (its `index.mts` mirrors the
 *     dir name). Nothing else is blessed; every other mismatch is a rename or a
 *     split.
 *   - **Exempt categories** — a test under an `integration/` or `e2e/` segment,
 *     or one that imports zero first-party sources, is never required to mirror.
 *
 *   Report-only by default (warn + exit 0) so the convention can roll out before
 *   the tree fully conforms; `--strict` fails on any violation (the eventual
 *   `check --all` mode). Pure classification (classifyTest / firstPartyImports)
 *   is exported for unit tests; the scan/report is the thin CLI shell.
 *
 *   Usage: node scripts/fleet/check/tests-are-mirror-named.mts [--strict] [--quiet]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const logger = getDefaultLogger()

// Category path segments whose tests never need to mirror a single source.
const EXEMPT_SEGMENTS = new Set(['e2e', 'integration'])

// First-party source roots — a resolved import under one of these is the
// repo's own code (the mirror target); anything else (node_modules, a sibling
// repo, a shared test helper) is not a mirror source.
const SOURCE_ROOTS = ['src', 'scripts', 'tools']

export interface TestClassification {
  kind: 'conforming' | 'exempt' | 'rename' | 'split'
  // For 'rename': the basename the test SHOULD carry. For 'split': the sources.
  detail?: string | undefined
  sources: string[]
}

// Strip a `.test` / `.spec` + extension tail to the mirrored basename.
function testBasename(testPath: string): string {
  return path.basename(testPath).replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, '')
}

// True when the test lives under an exempt category segment.
function isExemptLocation(relTestPath: string): boolean {
  return normalizePath(relTestPath)
    .split('/')
    .some(seg => EXEMPT_SEGMENTS.has(seg))
}

// True when the test's first line carries the inline-marker escape:
// `// socket-lint: mirror-exempt — <reason>`
// Used for residual tests whose only import is a broadly-shared util and where
// a rename to the util's basename would be a false mirror (the test exercises a
// feature, not the util itself). The reason is required and logged when `--strict`.
export function hasMirrorExemptMarker(content: string): boolean {
  const firstLine = content.split('\n')[0] ?? ''
  return /^\/\/\s*socket-lint:\s*mirror-exempt\s*—/.test(firstLine)
}

/**
 * Resolve a test file's FIRST-party static-import source paths (repo-relative,
 * POSIX). Only imports that resolve to an existing file under a SOURCE_ROOT of
 * this repo count; node_modules, bare specifiers, and sibling-repo paths are
 * dropped. Pure over (content, testPath, repoRoot) so it is unit-testable.
 */
export function firstPartyImports(
  content: string,
  testDir: string,
  repoRoot: string,
): string[] {
  const out = new Set<string>()
  // Static import/export-from: `import … from 'spec'` or `export … from 'spec'`.
  // Dynamic import call: `import('spec')` with optional surrounding whitespace.
  const re =
    /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(content))) {
    // A type-only import (`import type … from`, `export type … from`) is a
    // type dependency, not a unit under test — it never counts as a source.
    if (/^(?:import|export)\s+type\b/.test(m[0])) {
      continue
    }
    const spec = m[1] ?? m[2]
    if (!spec || !spec.startsWith('.')) {
      continue
    }
    const resolvedAbs = path.resolve(testDir, spec)
    const rel = path.relative(repoRoot, resolvedAbs).split(path.sep).join('/')
    if (rel.startsWith('..')) {
      continue
    }
    const first = normalizePath(rel).split('/')[0]
    if (!SOURCE_ROOTS.includes(first ?? '')) {
      continue
    }
    out.add(rel)
  }
  return [...out]
}

/**
 * Whether `basename` is a blessed off-mirror name for one of `sources`:
 * `<dir>` for a `<dir>/index.mts` (a hook / lint-rule whose unit IS its
 * directory). The check-by-name and shard blessings are handled separately
 * (they key off file existence / a prefix, not the import list).
 */
export function isBlessedVariant(basename: string, sources: string[]): boolean {
  for (let i = 0, { length } = sources; i < length; i += 1) {
    const src = sources[i]!
    const parts = normalizePath(src).split('/')
    const srcBase = path.basename(src).replace(/\.[cm]?[jt]sx?$/, '')
    const parent = parts[parts.length - 2] ?? ''
    const grandparent = parts[parts.length - 3] ?? ''
    if (
      srcBase === 'index' &&
      (basename === parent || basename === grandparent)
    ) {
      return true
    }
  }
  return false
}

// Blessed: `check-<name>.test.mts` conforms whenever a `check/<name>.mts`
// enforcer EXISTS (the test targets the check by its name; it often imports the
// lib the check delegates to, not the check script itself — so key off the file,
// not the import list).
export function isCheckByName(basename: string, repoRoot: string): boolean {
  const m = /^check-(.+)$/.exec(basename)
  if (!m) {
    return false
  }
  const name = m[1]!
  return ['scripts/fleet/check', 'scripts/repo/check'].some(dir =>
    existsSync(path.join(repoRoot, dir, `${name}.mts`)),
  )
}

// Blessed: a shard test `<srcBase>-<aspect>.test.mts` (or the bare
// `<srcBase>.test.mts`) for a source it imports — several focused test files
// deliberately splitting one large source (e.g. cover-thresholds, cover-discovery
// for cover.mts) each stay grouped under the source's basename prefix.
export function matchesShard(
  basename: string,
  sourceBasenames: string[],
): boolean {
  return sourceBasenames.some(
    sb => basename === sb || basename.startsWith(`${sb}-`),
  )
}

/**
 * Classify one test file against the mirror convention. Pure over the resolved
 * import list so the rule is unit-tested without a filesystem.
 */
export function classifyTest(
  relTestPath: string,
  sources: string[],
  repoRoot: string,
): TestClassification {
  if (isExemptLocation(relTestPath) || sources.length === 0) {
    return { kind: 'exempt', sources }
  }
  const base = testBasename(relTestPath)
  const baseNames = sources.map(s =>
    path.basename(s).replace(/\.[cm]?[jt]sx?$/, ''),
  )
  // Conforming when the test mirrors a source it imports (bare basename OR a
  // `<base>-<aspect>` shard), is a hook/rule dir unit, or is a check-by-name
  // enforcer test. Incidental helper/type imports don't disqualify it.
  if (
    matchesShard(base, baseNames) ||
    isBlessedVariant(base, sources) ||
    isCheckByName(base, repoRoot)
  ) {
    return { kind: 'conforming', sources }
  }
  // No mirror match: a single import is a rename to that source; two-plus with
  // no clear primary genuinely covers multiple units and must split.
  if (sources.length === 1) {
    return { kind: 'rename', detail: `${base} → ${baseNames[0]}`, sources }
  }
  return { kind: 'split', detail: sources.join(', '), sources }
}

interface Violation {
  kind: 'rename' | 'split'
  testPath: string
  detail: string
}

export function scanRepo(repoRoot: string): Violation[] {
  const testFiles = globSync(
    ['test/**/*.{test,spec}.{mts,ts,mjs,cjs,js,tsx,jsx}'],
    {
      cwd: repoRoot,
      absolute: false,
      ignore: ['**/node_modules/**', '**/fixtures/**'],
    },
  )
  const violations: Violation[] = []
  for (const rel of testFiles) {
    const abs = path.join(repoRoot, rel)
    let content = ''
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    if (hasMirrorExemptMarker(content)) {
      continue
    }
    const sources = firstPartyImports(content, path.dirname(abs), repoRoot)
    const c = classifyTest(rel, sources, repoRoot)
    if (c.kind === 'rename' || c.kind === 'split') {
      violations.push({ kind: c.kind, testPath: rel, detail: c.detail ?? '' })
    }
  }
  return violations
}

// Grandfather ratchet: entries here are legacy off-convention tests that
// predate the --strict flip. `--strict` fails only on NEW violations;
// `--update` rewrites the baseline DOWN as legacy tests conform. Same shape
// as scripts-have-unit-tests-baseline.json.
const BASELINE_PATH = '.config/repo/tests-mirror-baseline.json'

function readBaseline(): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as string[]
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function main(): number {
  const strict = process.argv.includes('--strict')
  const quiet = process.argv.includes('--quiet')
  const update = process.argv.includes('--update')
  let violations = scanRepo(REPO_ROOT)
  if (update) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(violations.map(v => v.testPath).toSorted(), null, 2)}\n`,
      'utf8',
    )
    logger.success(
      `[tests-are-mirror-named] baseline updated — ${violations.length} legacy test(s) grandfathered.`,
    )
    return 0
  }
  const baseline = readBaseline()
  const stale = [...baseline].filter(
    p => !violations.some(v => v.testPath === p),
  )
  if (stale.length && !quiet) {
    logger.warn(
      `[tests-are-mirror-named] ${stale.length} stale baseline entr(ies) — now conforming or removed; run --update to ratchet DOWN.`,
    )
  }
  violations = violations.filter(v => !baseline.has(v.testPath))
  if (!violations.length) {
    if (!quiet) {
      logger.success(
        '[tests-are-mirror-named] every unit test mirrors its source.',
      )
    }
    return 0
  }
  const renames = violations.filter(v => v.kind === 'rename')
  const splits = violations.filter(v => v.kind === 'split')
  const report = strict ? logger.fail.bind(logger) : logger.warn.bind(logger)
  report(
    `[tests-are-mirror-named] ${violations.length} test file(s) off-convention (${renames.length} rename, ${splits.length} split):`,
  )
  logger.group()
  for (const v of violations) {
    report(`${v.kind}: ${v.testPath}  (${v.detail})`)
  }
  logger.groupEnd()
  logger.log(
    'Rename a single-source test to its source basename; split a multi-source test into one file per source. Two variants are blessed: check-<name>, <hookdir>.',
  )
  if (strict) {
    process.exitCode = 1
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
