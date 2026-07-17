/**
 * @file Code-as-law: a fleet/repo CLI entry must FAIL SOFT — never hard-crash
 *   the user with a raw unhandled-rejection stack trace. The crash-prone shape
 *   is the async IIFE entrypoint `void (async () => { process.exitCode = await
 *   main() })()` with NO error handling: if `main()` rejects, the rejection is
 *   unhandled and Node prints a stack + exits nonzero uncontrolled. The fix is
 *   the shared `runMain(main)` (scripts/fleet/_shared/run-main.mts), which
 *   awaits main() inside a try/catch, logs the MESSAGE (not the stack), and
 *   sets the exit code. This check scans every `.mts` under scripts/fleet/ +
 *   scripts/repo/ and flags any entrypoint guard
 *   (`isMainModule(import.meta.url)` / `import.meta.main`) whose body launches
 *   an async IIFE without a `.catch`, `try`, or `runMain`. Sync `main()`
 *   entries + `.catch`-guarded ones are fine. Run standalone: `node
 *   scripts/fleet/check/entry-scripts-are-fail-soft.mts`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface Finding {
  // repo-root-relative path of the offending entry script.
  file: string
  // The crash-prone entry snippet (first offending line, trimmed).
  snippet: string
}

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
      findings.push({ file: rel, snippet: firstEntrySnippet(text) })
    }
  }
  return findings
}

function main(): number {
  const findings = scan()
  if (findings.length === 0) {
    logger.log('✔ every fleet/repo CLI entry is fail-soft')
    return 0
  }
  logger.error(
    `entry-scripts-are-fail-soft: ${findings.length} entrypoint(s) can crash with a raw unhandled-rejection stack.`,
  )
  logger.error(
    '  Use runMain(main) from scripts/fleet/_shared/run-main.mts instead of a bare `void (async () => { … await main() … })()`.',
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error(`  • ${f.file}: ${f.snippet}`)
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
