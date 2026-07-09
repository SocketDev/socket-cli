// Fleet check — every hook's main() runs only behind the entrypoint guard.
//
// A hook `index.mts` that exports testable helpers AND invokes `main()` (or
// `void main()` / `main().catch(...)`, or a top-level `await withEditGuard` /
// `withBashGuard`) at MODULE TOP LEVEL hangs forever when its test `import`s
// the module for those helpers: the top-level call fires on import and blocks
// reading a stdin that never arrives, so `node --test` (the hook-test runner)
// times out and gets SIGKILLed.
//
// The fix is the entrypoint guard — run main() only when the module is the
// process entrypoint, never on import:
//
//   if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
//     void main()
//   }
//
// or the equally-valid `fileURLToPath` form the check scripts use:
//
//   if (process.argv[1] === fileURLToPath(import.meta.url)) { main() }
//
// Why a gate: this exact hang fired across 15 hooks in two waves — the runner
// could not even reach their tests until each `main()` was wrapped. It was
// documented in memory but never enforced, so it kept recurring on every new
// hook. A documented-but-unenforced discipline is policy-on-paper (CLAUDE.md
// "Code is law"); this check makes the next hook that forgets the guard fail
// `check --all` instead of silently hanging the suite.
//
// Detection (text-level, no AST needed — the shapes are stable):
//   - The hook's relocated test `test/repo/{unit,integration}/hooks/<name>.test.mts`
//     IMPORTS the hook module. Hook tests are no longer co-located in the
//     cascaded `<name>/test/` tree — they live (wheelhouse-only) under
//     `test/repo/` and import the source by its full path ENDING IN
//     `.../<name>/index.mts` (or `/index`), via a static `import` or
//     `await import(`. This is the load-bearing precondition: the hang happens
//     ONLY on import, so a hook whose test spawns it as a subprocess instead
//     (and never imports it) is safe even when unguarded — flagging it would be
//     a false positive. No importing test → no hang → exempt.
//   - The module has a top-level `main()` invocation: a line matching `main()`
//     / `void main()` / `main().catch(` / `await main(` at COLUMN 0 (a guarded
//     call is indented inside the `if` block, so column-0 == unguarded), OR a
//     column-0 `await withEditGuard(` / `await withBashGuard(`.
//
// The relocated tests are WHEELHOUSE-ONLY (never cascaded): a member ships the
// hook sources but not their tests, so the scan no-ops (no `test/repo/`) outside
// the wheelhouse — `OWNS_RELOCATED_TESTS` gates it.
//
// Exempt: `_shared/` (helper library, not a hook); any hook with no index.mts;
// and any hook whose test does not import the module (spawn-only, or no test).
//
// Usage: node scripts/fleet/check/hook-main-is-entrypoint-guarded.mts [--quiet]

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { HOOK_TEST_DIRS, OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Directories under .claude/hooks/<seg>/ that are not hooks themselves.
const NON_HOOK_DIRS = new Set(['_shared'])

// A top-level (column-0) invocation of main() in one of its forms, or a
// top-level guard call. A guarded main() is indented under the `if`, so an
// anchored column-0 match is precisely the UNGUARDED shape.
const UNGUARDED_MAIN_RE =
  /^(?:void\s+main\(\)|await\s+main\(|main\(\)\.catch\(|main\(\))/m
const UNGUARDED_GUARD_CALL_RE = /^await\s+with(?:Bash|Edit)Guard\(/m

export interface UnguardedHit {
  // Repo-relative path of the offending index.mts.
  file: string
  // The matched top-level invocation, for the failure message.
  invocation: string
}

export interface ScanResult {
  // Offending hooks (unguarded top-level main() behind an importing test).
  hits: UnguardedHit[]
  // How many hooks were actually examined (an importing test exists). A zero
  // here means the scan is vacuous — surfaced so a no-op can't pass as green.
  scanned: number
}

// True when the hook's relocated test imports the hook module. The test now
// lives at `test/repo/{unit,integration}/hooks/<name>.test.mts` (wheelhouse-only)
// and imports the source by its full path, which ENDS IN `.../<name>/index.mts`
// (or `/index`). That import is the precondition for the hang: a spawn-only test
// (or no test) never loads the module in the test process, so an unguarded
// main() can't block it.
//
// Two import shapes are in use, both keyed on the hook `<name>`:
//   1. A single string ending in `/<name>/index.mts` (or `/index`) — a static
//      `import … from '…/<name>/index.mts'` or a single-line `await import('…')`.
//   2. A path split across `path.join(…)` segments inside an `await import(`:
//      the `<name>` is a path segment (in its own quoted string, or trailing a
//      `'…/hooks/<tier>/<name>'` string) and `'index.mts'`/`'index'` is a
//      separate quoted segment.
export function aTestImportsModule(name: string): boolean {
  // Single-string form: `…/<name>/index` or `…/<name>/index.mts`, anchored on a
  // `/` before <name> so a longer hook name can't match a shorter one.
  const singleStringRe = new RegExp(
    `/${escapeRegExp(name)}/index(?:\\.mts)?['"]`,
  )
  // Split form (segment 1): `<name>` as its own quoted segment, or as the tail
  // of a `'…/hooks/<tier>/<name>'` path string. Anchored on a `/` or quote
  // before <name>, and a closing quote after, so it matches a whole segment.
  const splitNameSegmentRe = new RegExp(`['"/]${escapeRegExp(name)}['"]`)
  // Split form (segment 2): the standalone `index` / `index.mts` segment.
  const splitIndexSegmentRe = /['"]index(?:\.mts)?['"]/
  for (let i = 0, { length } = HOOK_TEST_DIRS; i < length; i += 1) {
    const testPath = path.join(HOOK_TEST_DIRS[i]!, `${name}.test.mts`)
    let text: string
    try {
      text = readFileSync(testPath, 'utf8')
    } catch {
      continue
    }
    if (singleStringRe.test(text)) {
      return true
    }
    if (
      text.includes('await import(') &&
      splitNameSegmentRe.test(text) &&
      splitIndexSegmentRe.test(text)
    ) {
      return true
    }
  }
  return false
}

// Escape a string for safe interpolation into a RegExp source (the hook name is
// the only dynamic input; names are kebab-case, but escape defensively).
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The unguarded top-level invocation in `text`, or undefined when the file is
// clean (guarded, or has no top-level main()/guard call at all).
export function unguardedInvocation(text: string): string | undefined {
  const mainMatch = UNGUARDED_MAIN_RE.exec(text)
  if (mainMatch) {
    return mainMatch[0]
  }
  const guardMatch = UNGUARDED_GUARD_CALL_RE.exec(text)
  if (guardMatch) {
    return guardMatch[0]
  }
  return undefined
}

export function scanHookMains(
  repoRoot: string,
  options?: { ownsRelocatedTests?: boolean | undefined } | undefined,
): ScanResult {
  const opts = { __proto__: null, ...options }
  const hits: UnguardedHit[] = []
  let scanned = 0
  // The relocated hook tests are wheelhouse-only (under `test/repo/`). A member
  // ships the hook sources but not their tests, so there's no test to import the
  // module → nothing to check; no-op (scanned stays 0) and pass. Fixture tests
  // force ownership so the scan runs everywhere.
  if (!(opts.ownsRelocatedTests ?? OWNS_RELOCATED_TESTS)) {
    return { hits, scanned }
  }
  for (const seg of ['fleet', 'repo']) {
    const hooksDir = path.join(repoRoot, '.claude', 'hooks', seg)
    let entries: string[]
    try {
      entries = readdirSync(hooksDir)
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      if (NON_HOOK_DIRS.has(name)) {
        continue
      }
      const hookDir = path.join(hooksDir, name)
      const indexPath = path.join(hookDir, 'index.mts')
      let text: string
      try {
        text = readFileSync(indexPath, 'utf8')
      } catch {
        // No index.mts (install-only / doc-only hook) — nothing to check.
        continue
      }
      if (!aTestImportsModule(name)) {
        // No relocated test imports the module → an unguarded main() can't hang
        // it.
        continue
      }
      scanned += 1
      const invocation = unguardedInvocation(text)
      if (invocation) {
        hits.push({ file: path.relative(repoRoot, indexPath), invocation })
      }
    }
  }
  return { hits, scanned }
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const { hits, scanned } = scanHookMains(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-hook-main-is-entrypoint-guarded] hook main() runs at module top level (hangs the test on import):',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(`  ✗ ${h.file} — top-level \`${h.invocation}\``)
    }
    logger.error(
      '  Wrap the invocation in the entrypoint guard so it runs only when the',
    )
    logger.error('  module is the process entrypoint, never on import:')
    logger.error(
      '    if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {',
    )
    logger.error('      void main()')
    logger.error('    }')
    process.exitCode = 1
    return
  }
  // Surface the scanned count: a vacuous scan (0) is the very failure mode this
  // check was rewritten to fix, so make it visible rather than report a silent
  // green. In the wheelhouse `scanned` must be non-zero; a member legitimately
  // scans 0 (it ships no relocated tests) and the check no-ops in scanHookMains.
  if (OWNS_RELOCATED_TESTS && scanned === 0) {
    logger.fail(
      '[check-hook-main-is-entrypoint-guarded] scanned 0 hooks — the relocated-test discovery found no importing test (vacuous scan); check test/repo/{unit,integration}/hooks wiring.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[check-hook-main-is-entrypoint-guarded] all hook main() calls are entrypoint-guarded (scanned ${scanned} hook(s) with an importing test).`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
