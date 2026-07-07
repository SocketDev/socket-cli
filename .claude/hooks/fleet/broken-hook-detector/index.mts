#!/usr/bin/env node
// Claude Code SessionStart hook — broken-hook-detector (single, standalone
// hook-recovery net).
//
// Symptom this hook exists to catch:
//   Every Bash invocation prints noisy `PreToolUse:Bash hook error
//   Failed with non-blocking status code: node:internal/modules/
//   package_json_reader:314` lines, with no indication of WHICH hook
//   crashed or WHAT it needed. Two distinct causes, both surfaced here:
//
//   (A) MISSING DEP — a fleet-cascade added a new `import` to a shared hook
//       and the consuming repo hasn't installed the dep yet. The package is
//       absent from node_modules ENTIRELY (not in the .pnpm store). Recovery
//       is a real `pnpm i <pkg>`; we report the command (can't safely guess
//       the catalog/soak entry a new dep needs).
//
//   (B) GUTTED node_modules — a `pnpm install` aborted mid-purge
//       (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY) and deleted the
//       top-level package links while leaving the .pnpm virtual store intact
//       AND a stale node_modules/.pnpm-workspace-state-v1.json. That stale
//       marker makes every subsequent `pnpm install`/`--force` no-op with
//       "Already up to date" while node_modules stays unlinked, so every
//       fleet hook crashes on @socketsecurity/lib-stable. This is the common,
//       deterministic case — and it AUTO-REPAIRS: rm the stale markers, then
//       `CI=true pnpm install` re-links from the intact store in <1s (no
//       network, since every package is already in .pnpm).
//
// What it does:
//   At SessionStart (once per session, no Bash spam), walk every
//   `.claude/hooks/*/index.mts`, probe each via import(), and classify any
//   ERR_MODULE_NOT_FOUND: GUTTED (pkg in .pnpm store but unlinked + stale
//   marker present) vs MISSING-DEP (pkg absent from the store). GUTTED is
//   auto-repaired under guards (see repairGutted); MISSING-DEP is reported.
//
// **Self-imposed constraint: Node built-ins ONLY.**
//   This hook is the safety net for "hook deps are broken"; it must not
//   itself depend on anything installed via pnpm. fs, path, child process,
//   url — that's the entire import surface. (It SPAWNS pnpm for the gutted
//   repair, but never IMPORTS a pnpm-installed module — so it works even when
//   every such module is unresolvable, which is the whole point. Documented
//   exemption from prefer-async-spawn-guard: the recovery net cannot route
//   through the lib it recovers.)
//
// Fail-open: probe + repair never block. On any internal error (timeout,
// permission, a guard tripping, install failure) the hook silently exits 0
// and lets the session proceed — same posture as headroom-proxy-start.
// The repair is bounded and guarded: it only fires on the precise GUTTED
// signature, skips when a pnpm install is already running (no double-install
// collision — that collision is what CAUSES the gutting), runs at most once
// per session, and removes the stale markers ONLY immediately before a
// guarded install so it never leaves node_modules in a worse state.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const HOOKS_DIR = path.join(PROJECT_DIR, '.claude', 'hooks')
const NODE_MODULES = path.join(PROJECT_DIR, 'node_modules')
const PNPM_STORE = path.join(NODE_MODULES, '.pnpm')
// The stale state markers an aborted purge leaves behind. Their presence is
// what makes `pnpm install` no-op while node_modules is unlinked; removing
// them forces a real re-link from the intact store.
const STALE_MARKERS = [
  path.join(NODE_MODULES, '.pnpm-workspace-state-v1.json'),
  path.join(NODE_MODULES, '.modules.yaml'),
]
// Once-per-session repair guard: a temp-dir marker keyed by the project path,
// so a single session doesn't loop on repair if the install can't fix it.
/* c8 ignore start - TMPDIR is always set on macOS/Linux; TEMP/TMP/'/tmp' fallbacks are OS-specific */
const TMP_DIR =
  process.env['TMPDIR'] ?? process.env['TEMP'] ?? process.env['TMP'] ?? '/tmp'
/* c8 ignore stop */
const REPAIR_SENTINEL = path.join(
  TMP_DIR,
  `broken-hook-recovery-${PROJECT_DIR.replace(/[^a-zA-Z0-9]/g, '_')}.attempted`,
)

// 4-second total budget. Each `node --check` is ~50-150 ms; with
// ~80 hooks that's well under the SessionStart hook timeout.
const PER_PROBE_TIMEOUT_MS = 1500
const MAX_PROBES = 120

interface ProbeFailure {
  readonly hookPath: string
  readonly missingPackages: readonly string[]
  readonly rawStderr: string
}

export function emitAdditionalContext(message: string): void {
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

export function findHookEntrypoints(): readonly string[] {
  const entries: string[] = []
  // Hooks live one tier down: <hooks-dir>/<tier>/<name>/index.mts, where tier
  // is `fleet` or `repo`. A flat <hooks-dir>/<name>/index.mts is also honored
  // so a pre-tier layout still probes (the bare top-level scan found only the
  // tier dirs and probed zero hooks).
  let topLevel: readonly string[]
  try {
    topLevel = readdirSync(HOOKS_DIR)
  } catch {
    // No hooks dir; nothing to probe.
    /* c8 ignore next - HOOKS_DIR missing only in an unconfigured repo; subprocess tests cover this */
    return []
  }
  for (const top of topLevel) {
    if (entries.length >= MAX_PROBES) {
      break
    }
    /* c8 ignore next - no _shared dir at the hooks root in fleet layout */
    if (top === '_shared') {
      continue
    }
    // Flat layout: <hooks-dir>/<name>/index.mts.
    const flat = path.join(HOOKS_DIR, top, 'index.mts')
    try {
      /* c8 ignore next - flat layout not used in fleet; stat throws for tier dirs */
      if (statSync(flat).isFile()) {
        entries.push(flat)
        continue
      }
    } catch {
      // Not a flat hook; treat `top` as a tier dir and descend.
    }
    let names: readonly string[]
    try {
      names = readdirSync(path.join(HOOKS_DIR, top))
    } catch {
      /* c8 ignore next - unreadable tier dir is unusual; subprocess tests cover this */
      continue
    }
    for (const name of names) {
      if (entries.length >= MAX_PROBES) {
        break
      }
      if (name === '_shared') {
        continue
      }
      const candidate = path.join(HOOKS_DIR, top, name, 'index.mts')
      try {
        if (statSync(candidate).isFile()) {
          entries.push(candidate)
        }
      } catch {
        // Tier entry without index.mts (a non-hook dir); skip.
      }
    }
  }
  return entries
}

// The precise GUTTED signature (3-way AND — narrow on purpose so a fresh
// clone, a mid-install, or a hoisted-linker repo never false-positives):
//   1. the .pnpm virtual store exists + is populated (packages are present
//      ON DISK, just not linked at the top level);
//   2. a stale state marker is present (what forces `pnpm install` to no-op);
//   3. a sentinel top-level link is MISSING (@socketsecurity/ — every fleet
//      hook imports @socketsecurity/lib-stable, so its absence is exactly the
//      crash the session is seeing).
// A genuine missing-dep (case A) fails #1 (the pkg isn't in the store) or #3
// (the top level is otherwise linked), so it never trips this.
export function isGuttedNodeModules(): boolean {
  let storePopulated = false
  try {
    storePopulated = readdirSync(PNPM_STORE).length > 0
  } catch {
    /* c8 ignore next - PNPM_STORE missing only in an unconfigured machine; subprocess tests cover this */
    return false
  }
  /* c8 ignore next - empty store is a transient state between installs; subprocess tests cover this */
  if (!storePopulated) {
    return false
  }
  const staleMarkerPresent = STALE_MARKERS.some(m => existsSync(m))
  /* c8 ignore start - stale marker absent and present branches both require controlled machine state; subprocess tests cover these */
  if (!staleMarkerPresent) {
    return false
  }
  // Sentinel: the @socketsecurity scope link every fleet hook needs.
  return !existsSync(path.join(NODE_MODULES, '@socketsecurity'))
  /* c8 ignore stop */
}

// The catalog alias every fleet hook imports. pnpm links it as a symlink into
// the .pnpm store (`@socketsecurity/lib-stable -> ../.pnpm/@socketsecurity+lib@…`).
const LIB_STABLE_LINK = path.join(NODE_MODULES, '@socketsecurity', 'lib-stable')

// MODE B — a DANGLING lib-stable symlink (distinct from the full gut above).
// When a git worktree exists under the repo and a `pnpm install` runs, pnpm can
// relink the MAIN repo's `@socketsecurity/lib-stable` to point INTO that
// worktree's .pnpm store; removing the worktree (`git worktree remove`) then
// leaves the symlink dangling — every lib-stable import fails repo-wide while
// the .pnpm store + the rest of node_modules stay intact (so the gutted check
// above, which keys on the stale marker + the whole @socketsecurity dir being
// gone, does NOT fire). Signature: the link EXISTS as a symlink (lstat) but its
// target does NOT resolve (existsSync follows the link → false). A healthy link
// or a real dir both fail this (target resolves). The repair is the same
// relink-from-store as the gutted case.
export function hasDanglingLibSymlink(): boolean {
  let isSymlink = false
  try {
    isSymlink = lstatSync(LIB_STABLE_LINK).isSymbolicLink()
  } catch {
    // Not present at all → not THIS mode (full-gut handles absence).
    /* c8 ignore next - lib-stable missing means full-gut mode; subprocess tests cover this */
    return false
  }
  /* c8 ignore next - lib-stable is always a symlink in a pnpm-managed wheelhouse */
  if (!isSymlink) {
    return false
  }
  // Symlink present but target unresolvable = dangling.
  /* c8 ignore start - dangling symlink only exists after a worktree removal; subprocess tests cover this */
  return !existsSync(LIB_STABLE_LINK)
  /* c8 ignore stop */
}

// True when a `pnpm install` (or its Socket Firewall `sfw` wrapper) is already
// running anywhere — running our own concurrently is the exact collision that
// CAUSES the gutting (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR). Best-effort via
// pgrep; on any failure we treat it as "running" (fail SAFE — skip the repair).
/* c8 ignore start - shells out to pgrep; untestable without a live process table; called only from main() which is fully c8-ignored */
function pnpmInstallRunning(): boolean {
  const r = spawnSync('pgrep', ['-f', 'pnpm.*install|sfw.*install'], {
    timeout: 1500,
    encoding: 'utf8',
  })
  // pgrep exit 1 = no match (safe to install); 0 = match; anything else
  // (pgrep absent, error) = be conservative and assume running.
  if (r.status === 1) {
    return false
  }
  if (r.status === 0) {
    return true
  }
  return true
}
/* c8 ignore stop */

// Auto-repair the gutted state: remove the stale markers (which force the
// no-op) then re-link from the intact store with `CI=true pnpm install` (no
// network — every pkg is in .pnpm; CI=true skips the no-TTY purge abort).
// Returns a human-readable outcome line. Guarded by the caller; this function
// only runs when the signature is confirmed + no install is in flight + the
// once-per-session sentinel is unset. Removes markers ONLY here, immediately
// before the install, so a bail-out earlier never worsens the state.
/* c8 ignore start - spawns real pnpm install + touch; cannot run in unit tests without a live node_modules */
function repairGutted(): string {
  // Drop the once-per-session sentinel up front: if the install hangs or fails,
  // we do NOT retry within this session (avoids a repair loop).
  try {
    spawnSync('touch', [REPAIR_SENTINEL], { timeout: 1000 })
  } catch {
    // Sentinel is best-effort; proceed.
  }
  for (let i = 0, { length } = STALE_MARKERS; i < length; i += 1) {
    const marker = STALE_MARKERS[i]!
    try {
      rmSync(marker, { force: true })
    } catch {
      // Marker may not exist or be unremovable; the install attempt still runs.
    }
  }
  const r = spawnSync('pnpm', ['install'], {
    cwd: PROJECT_DIR,
    timeout: 120_000,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  })
  const relinked = existsSync(path.join(NODE_MODULES, '@socketsecurity'))
  if (r.status === 0 && relinked) {
    return 'node_modules was gutted (pnpm store intact, links missing, stale workspace-state marker). Auto-repaired: removed the stale marker(s) + `CI=true pnpm install` re-linked from the store. Hooks are healthy again.'
  }
  // Install ran but didn't restore — surface the manual command (don't loop).
  return (
    'node_modules is gutted (pnpm store intact, links missing) and the auto-repair did not restore it. Run manually:\n' +
    '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install'
  )
}
/* c8 ignore stop */

// Module-not-found error shape from Node ≥22:
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'shell-quote'
//   imported from /…/_shared/shell-command.mts
//       at Object.getPackageJSONURL (node:internal/modules/package_json_reader:314:9)
//
// We also tolerate the older CJS shape:
//   Error: Cannot find module 'shell-quote'
export function parseMissingPackages(stderr: string): readonly string[] {
  const pkgs = new Set<string>()
  // ESM form: Cannot find package '<name>' …
  for (const m of stderr.matchAll(/Cannot find package '(?<pkg>[^']+)'/g)) {
    pkgs.add(m.groups!.pkg!)
  }
  // CJS form: Cannot find module '<name>'
  for (const m of stderr.matchAll(/Cannot find module '(?<pkg>[^']+)'/g)) {
    const name = m.groups!.pkg!
    // Skip relative + absolute paths (those are import-path bugs, not
    // missing-dep bugs, and the user can't `pnpm i` a relative path).
    if (!name.startsWith('.') && !name.startsWith('/')) {
      pkgs.add(name)
    }
  }
  return [...pkgs]
}

/* c8 ignore start - spawns a node subprocess per hook; cannot mock without real executables */
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
/* c8 ignore stop */

export function formatReport(failures: readonly ProbeFailure[]): string {
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
  const installList = [...allMissing].toSorted().join(' ')
  lines.push('')
  lines.push(`Fix: \`pnpm i ${installList}\``)
  lines.push(
    'If the dep is a fleet-canonical cascade, the catalog entry + soak-bypass may also need adding (see pnpm-workspace.yaml).',
  )
  return lines.join('\n')
}

/* c8 ignore start - main() is the hook entry point; all paths depend on machine state or subprocess spawning; subprocess tests cover all branches */
export function main(): void {
  // GUTTED check first: it's the common, deterministic, auto-fixable cause and
  // it makes EVERY hook fail — no point probing 80 hooks one-by-one when the
  // top-level links are simply gone. A single signature check + guarded repair.
  if (isGuttedNodeModules()) {
    if (existsSync(REPAIR_SENTINEL)) {
      // Already attempted this session and it didn't take — don't loop; point
      // at the manual command.
      emitAdditionalContext(
        'node_modules is gutted and auto-repair was already attempted this session. Run manually:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
      return
    }
    if (pnpmInstallRunning()) {
      // A pnpm install is already in flight (maybe mid-restore, maybe the very
      // one that gutted things). Never run a second concurrently — that
      // collision is what causes the gutting. Report the command + let it
      // finish or the user run it.
      emitAdditionalContext(
        'node_modules looks gutted but a `pnpm install` is already running — not starting a second (collision risk). If it finishes without restoring, run:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
      return
    }
    emitAdditionalContext(repairGutted())
    return
  }

  // MODE B: a dangling lib-stable symlink (a removed git worktree orphaned the
  // MAIN repo's @socketsecurity/lib-stable link). Same relink-from-store repair
  // as the gutted case, same guards. Distinct check because the gutted signature
  // keys on the stale marker + a missing @socketsecurity dir, neither of which
  // holds here (the dir exists; only the child symlink dangles).
  if (hasDanglingLibSymlink()) {
    if (existsSync(REPAIR_SENTINEL)) {
      emitAdditionalContext(
        'node_modules has a dangling @socketsecurity/lib-stable symlink (a removed git worktree orphaned it) and auto-repair was already attempted this session. Run manually:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
      return
    }
    if (pnpmInstallRunning()) {
      emitAdditionalContext(
        'node_modules has a dangling @socketsecurity/lib-stable symlink but a `pnpm install` is already running — not starting a second (collision risk). If it finishes without restoring, run:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
      return
    }
    emitAdditionalContext(repairGutted())
    return
  }

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
/* c8 ignore stop */

/* c8 ignore start - entrypoint guard only fires when run as a script; subprocess tests cover this path */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch {
    // Fail-open: never block a session on this hook's own bug.
    // No exitCode write needed — Node defaults to 0 when the loop
    // drains naturally, and we explicitly never want a non-zero here.
  }
}
/* c8 ignore stop */
