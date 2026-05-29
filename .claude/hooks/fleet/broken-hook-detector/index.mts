#!/usr/bin/env node
// Claude Code SessionStart hook — broken-hook-detector.
//
// Symptom this hook exists to catch:
//   Every Bash invocation prints noisy `PreToolUse:Bash hook error
//   Failed with non-blocking status code: node:internal/modules/
//   package_json_reader:314` lines, with no indication of WHICH hook
//   crashed or WHAT it needed. Happens whenever a fleet-cascade adds
//   a new `import` to a shared hook (e.g. `_shared/shell-command.mts`)
//   and the consuming repo hasn't installed the dep yet.
//
// What it does:
//   At SessionStart (once per session, no Bash spam), walk every
//   `.claude/hooks/*/index.mts` plus `.claude/hooks/_shared/*.mts`,
//   spawn `node --check` on each, and aggregate the failures. If any
//   crash with ERR_MODULE_NOT_FOUND, surface ONE structured message
//   that names: the failing hook, the missing package(s), and the
//   exact `pnpm i` recovery command.
//
// **Self-imposed constraint: Node built-ins ONLY.**
//   This hook is the safety net for "hook deps are broken"; it must
//   not itself depend on anything installed via pnpm. fs, path, child
//   process, url — that's the entire import surface.
//
// Fail-open: probe never blocks. On any internal error (timeout,
// permission, whatever) the hook silently exits 0 and lets the
// session proceed — same posture as socket-token-minifier-start.

import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const HOOKS_DIR = path.join(PROJECT_DIR, '.claude', 'hooks')

// 4-second total budget. Each `node --check` is ~50-150 ms; with
// ~80 hooks that's well under the SessionStart hook timeout.
const PER_PROBE_TIMEOUT_MS = 1500
const MAX_PROBES = 120

interface ProbeFailure {
  readonly hookPath: string
  readonly missingPackages: readonly string[]
  readonly rawStderr: string
}

function emitAdditionalContext(message: string): void {
  // Stdout is the only channel Claude Code reads for SessionStart
  // hooks. additionalContext lands as informational text in the
  // transcript; it does NOT block the session.
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[broken-hook-detector] ${message}`,
    },
  }
  process.stdout.write(JSON.stringify(out))
}

function findHookEntrypoints(): readonly string[] {
  const entries: string[] = []
  // Each hook lives at <hooks-dir>/<name>/index.mts.
  let topLevel: readonly string[]
  try {
    topLevel = readdirSync(HOOKS_DIR)
  } catch {
    // No hooks dir; nothing to probe.
    return []
  }
  for (const name of topLevel) {
    if (entries.length >= MAX_PROBES) {
      break
    }
    if (name === '_shared') {
      continue
    }
    const candidate = path.join(HOOKS_DIR, name, 'index.mts')
    try {
      if (statSync(candidate).isFile()) {
        entries.push(candidate)
      }
    } catch {
      // Hook dir without index.mts is fine; skip.
    }
  }
  return entries
}

// Module-not-found error shape from Node ≥22:
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'shell-quote'
//   imported from /…/_shared/shell-command.mts
//       at Object.getPackageJSONURL (node:internal/modules/package_json_reader:314:9)
//
// We also tolerate the older CJS shape:
//   Error: Cannot find module 'shell-quote'
function parseMissingPackages(stderr: string): readonly string[] {
  const pkgs = new Set<string>()
  // ESM form: Cannot find package '<name>' …
  for (const m of stderr.matchAll(/Cannot find package '([^']+)'/g)) {
    pkgs.add(m[1]!)
  }
  // CJS form: Cannot find module '<name>'
  for (const m of stderr.matchAll(/Cannot find module '([^']+)'/g)) {
    const name = m[1]!
    // Skip relative + absolute paths (those are import-path bugs, not
    // missing-dep bugs, and the user can't `pnpm i` a relative path).
    if (!name.startsWith('.') && !name.startsWith('/')) {
      pkgs.add(name)
    }
  }
  return [...pkgs]
}

function probeHook(hookPath: string): ProbeFailure | undefined {
  // `node --check` does syntax-only validation and won't import the
  // graph. Use `--input-type=module` and read the file as the input
  // so module resolution actually happens. But that's heavy — the
  // cheaper alternative: dynamic import via a tiny one-liner that
  // exits 0 after the import succeeds.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      // Resolving-only via import() lets the resolver run without
      // executing top-level code that might block (e.g. start a
      // server). Success → loop drains, exit 0. Failure → Node's
      // default unhandled-rejection handler prints the error to
      // stderr and exits non-zero — the parent reads result.stderr
      // for "Cannot find package" matching, no try/catch needed.
      //
      // file:// form is required for cross-platform correctness: on
      // Windows, an absolute path like `C:\foo\bar.mts` looks like a
      // URL scheme (`C:`) to the ESM resolver and throws
      // ERR_UNSUPPORTED_ESM_URL_SCHEME. pathToFileURL handles the
      // platform-specific quoting + scheme prefix.
      `await import(${JSON.stringify(pathToFileURL(hookPath).href)})`,
    ],
    {
      timeout: PER_PROBE_TIMEOUT_MS,
      // Inherit nothing — keep the probe sandboxed from the real
      // session env so any env-var quirks don't surface as false
      // positives. CLAUDE_PROJECT_DIR is preserved because some
      // hooks read it at import time.
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        CLAUDE_PROJECT_DIR: PROJECT_DIR,
        // Suppress node's deprecation warnings during the probe;
        // unrelated to broken-hook detection.
        NODE_NO_WARNINGS: '1',
      },
      encoding: 'utf8',
    },
  )
  if (result.status === 0) {
    return undefined
  }
  // Non-zero exit OR timeout. spawnSync sets status=null on timeout;
  // treat timeout as inconclusive (skip rather than false-positive).
  if (result.status === null) {
    return undefined
  }
  const stderr = result.stderr ?? ''
  // Only flag genuine missing-dep failures. Syntax errors, runtime
  // errors, etc. aren't this hook's job to surface.
  if (
    !stderr.includes('ERR_MODULE_NOT_FOUND') &&
    !stderr.includes('Cannot find package') &&
    !stderr.includes('Cannot find module')
  ) {
    return undefined
  }
  const missing = parseMissingPackages(stderr)
  if (missing.length === 0) {
    return undefined
  }
  return {
    hookPath,
    missingPackages: missing,
    rawStderr: stderr.slice(0, 2000),
  }
}

function formatReport(failures: readonly ProbeFailure[]): string {
  // Aggregate unique missing packages across all failures so the
  // suggested `pnpm i` recovers everything in one call.
  const allMissing = new Set<string>()
  for (const f of failures) {
    for (const p of f.missingPackages) {
      allMissing.add(p)
    }
  }
  const lines: string[] = []
  lines.push(
    `${failures.length} hook${failures.length === 1 ? '' : 's'} failed to load due to missing packages:`,
  )
  for (const f of failures) {
    const relPath = path.relative(PROJECT_DIR, f.hookPath)
    lines.push(`  - ${relPath} → ${f.missingPackages.join(', ')}`)
  }
  const installList = [...allMissing].sort().join(' ')
  lines.push('')
  lines.push(`Fix: \`pnpm i ${installList}\``)
  lines.push(
    'If the dep is a fleet-canonical cascade, the catalog entry + soak-bypass may also need adding (see pnpm-workspace.yaml).',
  )
  return lines.join('\n')
}

function main(): void {
  const entrypoints = findHookEntrypoints()
  if (entrypoints.length === 0) {
    return
  }
  const failures: ProbeFailure[] = []
  for (const entry of entrypoints) {
    const failure = probeHook(entry)
    if (failure !== undefined) {
      failures.push(failure)
    }
  }
  if (failures.length === 0) {
    return
  }
  emitAdditionalContext(formatReport(failures))
}

try {
  main()
} catch {
  // Fail-open: never block a session on this hook's own bug.
  // No exitCode write needed — Node defaults to 0 when the loop
  // drains naturally, and we explicitly never want a non-zero here.
}
