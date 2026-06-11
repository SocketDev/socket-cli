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
//   - A sibling `test/*.test.mts` IMPORTS the hook module (`from '../index'`).
//     This is the load-bearing precondition: the hang happens ONLY on import,
//     so a hook whose test spawns it as a subprocess instead (and never
//     imports it) is safe even when unguarded — flagging it would be a false
//     positive. No importing test → no hang → exempt.
//   - The module has a top-level `main()` invocation: a line matching `main()`
//     / `void main()` / `main().catch(` / `await main(` at COLUMN 0 (a guarded
//     call is indented inside the `if` block, so column-0 == unguarded), OR a
//     column-0 `await withEditGuard(` / `await withBashGuard(`.
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

import { REPO_ROOT } from '../paths.mts'

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

// True when any `test/*.test.mts` beside the hook imports the hook module
// (`from '../index.mts'` / `from '../index'`). That import is the precondition
// for the hang: a spawn-only test (or no test) never loads the module in the
// test process, so an unguarded main() can't block it.
export function aTestImportsModule(hookDir: string): boolean {
  const testDir = path.join(hookDir, 'test')
  let entries: string[]
  try {
    entries = readdirSync(testDir)
  } catch {
    return false
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (!name.endsWith('.test.mts')) {
      continue
    }
    let text: string
    try {
      text = readFileSync(path.join(testDir, name), 'utf8')
    } catch {
      continue
    }
    if (/from\s+['"]\.\.\/index(?:\.mts)?['"]/.test(text)) {
      return true
    }
  }
  return false
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

export function scanHookMains(repoRoot: string): UnguardedHit[] {
  const hits: UnguardedHit[] = []
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
      if (!aTestImportsModule(hookDir)) {
        // No test imports the module → an unguarded main() can't hang it.
        continue
      }
      const invocation = unguardedInvocation(text)
      if (invocation) {
        hits.push({ file: path.relative(repoRoot, indexPath), invocation })
      }
    }
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanHookMains(REPO_ROOT)
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
  if (!quiet) {
    logger.success(
      '[check-hook-main-is-entrypoint-guarded] all hook main() calls are entrypoint-guarded.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
