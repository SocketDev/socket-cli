/*
 * @file Code-as-law: a fleet/repo CLI entry must FAIL SOFT — never hard-crash
 *   the user with a raw unhandled-rejection stack trace, and never run its
 *   side effect just because a LIBRARY consumer imported the module. Two
 *   entrypoint shapes are flagged, scanning every `.mts` under scripts/fleet/
 *   \+ scripts/repo/:
 *
 *   1. crash-prone — the async IIFE entrypoint `void (async () => {
 *      process.exitCode = await main() })()` with NO error handling: if
 *      `main()` rejects, the rejection is unhandled and Node prints a stack +
 *      exits nonzero uncontrolled. The fix is the shared `runMain(main)`
 *      (scripts/fleet/_shared/run-main.mts), which awaits main() inside a
 *      try/catch, logs the MESSAGE, not the stack, and sets the exit code. Sync
 *      `main()` entries + `.catch`-guarded ones are fine.
 *   2. unguarded-main — a module defines `main` and invokes it at module scope
 *      (`main()`, `void main()`, `runMain(main)`, `process.exitCode = await
 *      main()`, an unguarded `try { main() } catch`, …) with NO
 *      `isMainModule(import.meta.url)` / `import.meta.main` entry guard
 *      anywhere in the file. Importing such a module as a library runs `main()`
 *      against the CALLER's argv. The fix is the same guard shape landed in
 *      f67ae7d71: `if (isMainModule(import.meta.url)) { … }` wrapping the
 *      existing invocation, unchanged. Run standalone: `node
 *      scripts/fleet/check/entry-scripts-are-fail-soft.mts`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface Finding {
  // repo-root-relative path of the offending entry script.
  file: string
  // Which entrypoint defect this is — each has its own fix + message.
  kind: 'crash-prone' | 'unguarded-main'
  // The offending entry snippet, first offending line, trimmed.
  snippet: string
}

// Files whose module-scope main() invocation is DELIBERATELY unguarded:
// test-runner/run-vitest.mts is always spawned as its OWN process (see its
// header), never imported — the run() bridge in test.mts shells out to it
// with `node`, so `isMainModule` would always be true there anyway, and the
// argv it receives is vitest's, not this fleet's.
const UNGUARDED_MAIN_ALLOWLIST = new Set<string>([
  'scripts/fleet/test-runner/run-vitest.mts',
])

// The entrypoint-guard openers a fleet script uses to run main() only when it
// IS the process entry.
const ENTRY_GUARD_RE =
  /\bisMainModule\(import\.meta\.url\)|\bimport\.meta\.main\b/

/**
 * True when `text` (a whole .mts source) contains a crash-prone async-IIFE
 * entrypoint: a `void (async ...)` launched from an entry guard with no error
 * handling (`runMain` / `.catch` / `try`). Pure — the file-scan wrapper reads
 * disk. Kept deliberately conservative: it only flags the one shape that leaks
 * an unhandled rejection, so a sync `main()` or a `.catch`-guarded invoke never
 * trips it.
 */
export function isCrashProneEntry(text: string): boolean {
  if (!ENTRY_GUARD_RE.test(text)) {
    return false
  }
  // Already using the fail-soft runner → safe.
  if (/\brunMain\s*\(/.test(text)) {
    return false
  }
  // Inspect each async IIFE's OWN body (not the whole file — a `try` elsewhere
  // in the script doesn't protect the entrypoint). An IIFE that runs `main()`
  // without its own `try` / `.catch` leaks an unhandled rejection.
  const iifeRe = /\(async\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*\(\s*\)/g
  let m: RegExpExecArray | null
  while ((m = iifeRe.exec(text)) !== null) {
    const body = m[1] ?? ''
    // Only the entrypoint IIFE (the one that runs main()) matters.
    if (!/\bmain\s*\(/.test(body)) {
      continue
    }
    // The IIFE guards its own errors (a `try` / `.catch` in its body) → safe.
    if (/\btry\s*\{/.test(body) || /\.catch\s*\(/.test(body)) {
      continue
    }
    // A `.catch(...)` chained on the IIFE result (`})().catch(...)`) handles
    // the rejection too → safe.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 16)
    if (/^\s*\.catch\s*\(/.test(after)) {
      continue
    }
    return true
  }
  return false
}

export function firstEntrySnippet(text: string): string {
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (/\(async\s*\(\s*\)\s*=>\s*\{/.test(lines[i]!)) {
      return lines[i]!.trim()
    }
  }
  /* c8 ignore next - unreachable: only called after isCrashProneEntry matched the async IIFE */
  return '(async IIFE)'
}

// A module-scope statement that runs `main()` — every guarded invocation in
// this codebase's convention lives one level deeper, nested inside the entry
// guard's braces (`if (isMainModule(import.meta.url)) { … }`), so a matching
// line flush against the left margin is always OUTSIDE any guard. Each
// alternative mirrors one of the invocation shapes this fleet's scripts
// actually use.
const UNGUARDED_MAIN_OPENER_RE =
  /^(?:void\s+)?main\s*\(|^process\.exitCode\s*=\s*(?:await\s+)?main\s*\(|^runMain\s*\(\s*main\s*\)|^void\s*\(async\s*\(\s*\)\s*=>\s*\{|^export\s+const\s+\w+\s*=\s*main\s*\(/m

// True when a module-scope `try { … main() … }` (unindented, so outside any
// entry guard) exists — the one invocation shape UNGUARDED_MAIN_OPENER_RE
// can't see on its own, since the `try {` opener line doesn't itself mention
// `main(`.
function hasUnguardedTryMain(text: string): boolean {
  const m = /^try\s*\{([\s\S]*?)^\}/m.exec(text)
  return m !== null && /\bmain\s*\(/.test(m[1] ?? '')
}

/**
 * True when `text` defines `main` and invokes it at module scope with no
 * `isMainModule(import.meta.url)` / `import.meta.main` guard anywhere in the
 * file. Deliberately conservative, same spirit as {@link isCrashProneEntry}:
 * it only recognizes the invocation shapes this fleet's scripts actually use,
 * so a pure helper module with no `main` at all never trips it.
 */
export function hasUnguardedMainInvocation(text: string): boolean {
  if (!/\b(?:export\s+)?(?:async\s+)?function\s+main\s*\(/.test(text)) {
    return false
  }
  return UNGUARDED_MAIN_OPENER_RE.test(text) || hasUnguardedTryMain(text)
}

export function firstUnguardedMainSnippet(text: string): string {
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (UNGUARDED_MAIN_OPENER_RE.test(line) || /^try\s*\{\s*$/.test(line)) {
      return line.trim()
    }
  }
  /* c8 ignore next - unreachable: only called after hasUnguardedMainInvocation matched */
  return 'main()'
}

export function scan(repoRoot: string = REPO_ROOT): Finding[] {
  const files = globSync(['scripts/fleet/**/*.mts', 'scripts/repo/**/*.mts'], {
    absolute: false,
    cwd: repoRoot,
  })
  const findings: Finding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    let text = ''
    try {
      text = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      /* c8 ignore next - glob returned the path moments ago; a read race is not testable */
      continue
    }
    if (isCrashProneEntry(text)) {
      findings.push({
        file: rel,
        kind: 'crash-prone',
        snippet: firstEntrySnippet(text),
      })
    }
    if (
      !UNGUARDED_MAIN_ALLOWLIST.has(rel) &&
      hasUnguardedMainInvocation(text)
    ) {
      findings.push({
        file: rel,
        kind: 'unguarded-main',
        snippet: firstUnguardedMainSnippet(text),
      })
    }
  }
  return findings
}

export function main(): number {
  const findings = scan()
  if (findings.length === 0) {
    logger.log('✔ every fleet/repo CLI entry is fail-soft')
    return 0
  }
  const crashProne = findings.filter(f => f.kind === 'crash-prone')
  const unguardedMain = findings.filter(f => f.kind === 'unguarded-main')
  if (crashProne.length > 0) {
    logger.error(
      `entry-scripts-are-fail-soft: ${crashProne.length} entrypoint(s) can crash with a raw unhandled-rejection stack.`,
    )
    logger.error(
      '  Use runMain(main) from scripts/fleet/_shared/run-main.mts instead of a bare `void (async () => { … await main() … })()`.',
    )
    for (let i = 0, { length } = crashProne; i < length; i += 1) {
      const f = crashProne[i]!
      logger.error(`  • ${f.file}: ${f.snippet}`)
    }
  }
  if (unguardedMain.length > 0) {
    logger.error(
      `entry-scripts-are-fail-soft: ${unguardedMain.length} entrypoint(s) invoke main() unconditionally at module scope.`,
    )
    logger.error(
      "  Importing the file as a library runs main() against the CALLER's argv. Wrap the existing invocation: `if (isMainModule(import.meta.url)) { … }`.",
    )
    for (let i = 0, { length } = unguardedMain; i < length; i += 1) {
      const f = unguardedMain[i]!
      logger.error(`  • ${f.file}: ${f.snippet}`)
    }
  }
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every CLI entry script fails soft and guards its module-scope main',
  help: 'Usage: node scripts/fleet/check/entry-scripts-are-fail-soft.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
