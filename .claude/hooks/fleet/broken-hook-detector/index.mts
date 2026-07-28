#!/usr/bin/env node
// Claude Code SessionStart hook — broken-hook-detector (the fleet hook-recovery
// net). Folded into the dispatch bundle: it exports a `defineHook` `check` the
// dispatcher runs for the SessionStart event, so a member's settings.json wires
// only the dispatch loader — never this source `.mts`.
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
//       source hook crashes on @socketsecurity/lib-stable. This is the common,
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
//   A member checkout ships no source `.mts` hooks, so findHookEntrypoints
//   returns nothing there and the probe loop is a no-op; the loop does its
//   real work in the wheelhouse and any source-carrying checkout.
//
// Bundling this hook makes it SELF-CONTAINED: rolldown inlines the reachable
//   `@socketsecurity/lib-stable` slices into `_dist/bundle.cjs`, so the recovery
//   net keeps running even when node_modules is gutted — the exact state it
//   recovers from. (It SPAWNS the package manager for the gutted repair, but
//   never resolves a pnpm-installed module at runtime — documented exemption
//   from prefer-async-spawn-guard: the recovery net cannot route through the lib
//   it recovers.)
//
// Project-dir + every derived path resolve at RUNTIME inside check() (never at
//   module scope) so the hook is correct whether it runs from the require-time
//   `_dist/bundle.cjs` (member + wheelhouse index.cjs path) or frozen into the
//   V8 startup snapshot (wheelhouse launcher path) — a module-scope
//   `process.env` read would freeze to the build-time value in the snapshot.
//
// Fail-open: probe + repair never block. On any internal error (timeout,
// permission, a guard tripping, install failure) the hook silently returns and
// lets the session proceed — same posture as headroom-proxy-start. The repair
// is bounded and guarded: it only fires on the precise GUTTED signature, skips
// when a package-manager install is already running (no double-install
// collision — that collision is what CAUSES the gutting), runs at most once per
// session, and removes the stale markers ONLY immediately before a guarded
// install so it never leaves node_modules in a worse state.

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

// 4-second total budget. Each probe subprocess is ~50-150 ms; with
// ~80 hooks that's well under the SessionStart hook timeout.
const PER_PROBE_TIMEOUT_MS = 1500
const MAX_PROBES = 120

// Every filesystem location this hook touches, derived from the project dir the
// session acts on. Resolved at RUNTIME (see the header note on snapshot safety).
export interface RepoPaths {
  readonly hooksDir: string
  readonly libStableLink: string
  readonly nodeModules: string
  readonly pnpmStore: string
  readonly projectDir: string
  readonly repairSentinel: string
  readonly staleMarkers: readonly string[]
}

// The stale state markers an aborted purge leaves behind. Their presence is
// what makes `pnpm install` no-op while node_modules is unlinked; removing
// them forces a real re-link from the intact store.
export function resolveRepoPaths(projectDir: string): RepoPaths {
  const nodeModules = path.join(projectDir, 'node_modules')
  // Once-per-session repair guard: a temp-dir marker keyed by the project path,
  // so a single session doesn't loop on repair if the install can't fix it.
  /* c8 ignore next - TMPDIR is always set on macOS/Linux; TEMP/TMP/'/tmp' fallbacks are OS-specific */
  const tmpDir =
    process.env['TMPDIR'] ?? process.env['TEMP'] ?? process.env['TMP'] ?? '/tmp'
  return {
    __proto__: null,
    hooksDir: path.join(projectDir, '.claude', 'hooks'),
    // The catalog alias every fleet hook imports. pnpm links it as a symlink
    // into the .pnpm store (`@socketsecurity/lib-stable -> ../.pnpm/…`).
    libStableLink: path.join(nodeModules, '@socketsecurity', 'lib-stable'),
    nodeModules,
    pnpmStore: path.join(nodeModules, '.pnpm'),
    projectDir,
    repairSentinel: path.join(
      tmpDir,
      `broken-hook-recovery-${projectDir.replace(/[^a-zA-Z0-9]/g, '_')}.attempted`,
    ),
    staleMarkers: [
      path.join(nodeModules, '.pnpm-workspace-state-v1.json'),
      path.join(nodeModules, '.modules.yaml'),
    ],
  } as RepoPaths
}

interface ProbeFailure {
  readonly hookPath: string
  readonly missingPackages: readonly string[]
  readonly rawStderr: string
}

export function findHookEntrypoints(hooksDir: string): readonly string[] {
  const entries: string[] = []
  // Hooks live one tier down: <hooks-dir>/<tier>/<name>/index.mts, where tier
  // is `fleet` or `repo`. A flat <hooks-dir>/<name>/index.mts is also honored
  // so a pre-tier layout still probes (the bare top-level scan found only the
  // tier dirs and probed zero hooks).
  let topLevel: readonly string[]
  try {
    topLevel = readdirSync(hooksDir)
  } catch {
    // No hooks dir; nothing to probe.
    /* c8 ignore next - hooksDir missing only in an unconfigured repo; subprocess tests cover this */
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
    const flat = path.join(hooksDir, top, 'index.mts')
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
      names = readdirSync(path.join(hooksDir, top))
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
      const candidate = path.join(hooksDir, top, name, 'index.mts')
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
export function isGuttedNodeModules(paths: RepoPaths): boolean {
  let storePopulated = false
  try {
    storePopulated = readdirSync(paths.pnpmStore).length > 0
  } catch {
    /* c8 ignore next - pnpmStore missing only in an unconfigured machine; subprocess tests cover this */
    return false
  }
  /* c8 ignore next - empty store is a transient state between installs; subprocess tests cover this */
  if (!storePopulated) {
    return false
  }
  const staleMarkerPresent = paths.staleMarkers.some(m => existsSync(m))
  /* c8 ignore start - stale marker absent and present branches both require controlled machine state; subprocess tests cover these */
  if (!staleMarkerPresent) {
    return false
  }
  // Sentinel: the @socketsecurity scope link every fleet hook needs.
  return !existsSync(path.join(paths.nodeModules, '@socketsecurity'))
  /* c8 ignore stop */
}

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
export function hasDanglingLibSymlink(libStableLink: string): boolean {
  let isSymlink = false
  try {
    isSymlink = lstatSync(libStableLink).isSymbolicLink()
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
  return !existsSync(libStableLink)
  /* c8 ignore stop */
}

// True when a package-manager install (or its Socket Firewall `sfw` wrapper) is
// already running anywhere — running our own concurrently is the exact collision
// that CAUSES the gutting (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR). Best-effort via
// pgrep; on any failure we treat it as "running" (fail SAFE — skip the repair).
/* c8 ignore start - shells out to pgrep; untestable without a live process table; called only from check() which is fully c8-ignored */
export function pnpmInstallRunning(): boolean {
  const r = spawnSync('pgrep', ['-f', 'pnpm.*install|sfw.*install'], {
    timeout: spawnTimeoutMs(1500),
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
/* c8 ignore start - spawns a real install + touch; needs a live install tree no unit test provides */
export function repairGutted(paths: RepoPaths): string {
  // Drop the once-per-session sentinel up front: if the install hangs or fails,
  // we do NOT retry within this session (avoids a repair loop).
  try {
    spawnSync('touch', [paths.repairSentinel], {
      timeout: spawnTimeoutMs(1000),
    })
  } catch {
    // Sentinel is best-effort; proceed.
  }
  for (let i = 0, { length } = paths.staleMarkers; i < length; i += 1) {
    const marker = paths.staleMarkers[i]!
    try {
      safeDeleteSync(marker)
    } catch {
      // Marker may not exist or be unremovable; the install attempt still runs.
    }
  }
  const r = spawnSync('pnpm', ['install'], {
    cwd: paths.projectDir,
    timeout: 120_000,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    // Windows shell-shim: pnpm is pnpm.cmd there; an unshelled spawnSync
    // cannot execute it (the variant of the bump-order gate's fail-open).
    shell: WIN32,
  })
  const relinked = existsSync(path.join(paths.nodeModules, '@socketsecurity'))
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
    pkgs.add(m.groups!['pkg']!)
  }
  // CJS form: Cannot find module '<name>'
  for (const m of stderr.matchAll(/Cannot find module '(?<pkg>[^']+)'/g)) {
    const name = m.groups!['pkg']!
    // Skip relative + absolute paths (those are import-path bugs, not
    // missing-dep bugs, and the user can't `pnpm i` a relative path).
    if (!name.startsWith('.') && !name.startsWith('/')) {
      pkgs.add(name)
    }
  }
  return [...pkgs]
}

/* c8 ignore start - spawns a probe subprocess per hook; cannot mock without real executables */
export function probeHook(
  hookPath: string,
  projectDir: string,
): ProbeFailure | undefined {
  // Resolving-only via import() lets the resolver run without executing
  // top-level code that might block. Success → exit 0. Failure → the default
  // unhandled-rejection handler prints the error to stderr and exits non-zero —
  // the parent reads result.stderr for "Cannot find package" matching, no
  // try/catch needed. file:// form is required for cross-platform correctness:
  // on Windows an absolute path like `C:\foo\bar.mts` looks like a URL scheme to
  // the ESM resolver; pathToFileURL handles the quoting + prefix.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(hookPath).href)})`,
    ],
    {
      timeout: PER_PROBE_TIMEOUT_MS,
      // Inherit nothing — keep the probe sandboxed from the real session env so
      // any env-var quirks don't surface as false positives. CLAUDE_PROJECT_DIR
      // is preserved because some hooks read it at import time.
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        CLAUDE_PROJECT_DIR: projectDir,
        // Suppress deprecation warnings during the probe.
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
  // Only flag genuine missing-dep failures. Syntax errors, runtime errors, etc.
  // aren't this hook's job to surface.
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

export function formatReport(
  failures: readonly ProbeFailure[],
  projectDir: string,
): string {
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
    const relPath = path.relative(projectDir, f.hookPath)
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

// The SessionStart verdict: repair the deterministic gutted/dangling cases
// first (they make EVERY hook fail, so there's no point probing one-by-one),
// else probe each source hook for a missing-dep failure. Returns a notify
// verdict the dispatcher surfaces, or undefined (silent allow). Every path
// resolves its filesystem locations from `paths` (runtime-derived) — never a
// module-scope constant.
export function check(payload: ToolCallPayload): GuardResult {
  const projectDir = resolveProjectDir(
    typeof payload?.cwd === 'string' ? payload.cwd : undefined,
  )
  const paths = resolveRepoPaths(projectDir)
  // GUTTED check first: it's the common, deterministic, auto-fixable cause and
  // it makes EVERY source hook fail — no point probing 80 hooks one-by-one when
  // the top-level links are simply gone. A single signature check + guarded
  // repair.
  if (isGuttedNodeModules(paths)) {
    /* c8 ignore start - repair/guard branches depend on live machine state + subprocess spawning; subprocess tests cover them */
    if (existsSync(paths.repairSentinel)) {
      // Already attempted this session and it didn't take — don't loop; point
      // at the manual command.
      return notify(
        '[broken-hook-detector] node_modules is gutted and auto-repair was already attempted this session. Run manually:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
    }
    if (pnpmInstallRunning()) {
      // An install is already in flight (maybe mid-restore, maybe the very one
      // that gutted things). Never run a second concurrently — that collision
      // is what causes the gutting.
      return notify(
        '[broken-hook-detector] node_modules looks gutted but a `pnpm install` is already running — not starting a second (collision risk). If it finishes without restoring, run:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
    }
    return notify(`[broken-hook-detector] ${repairGutted(paths)}`)
    /* c8 ignore stop */
  }

  // MODE B: a dangling lib-stable symlink (a removed git worktree orphaned the
  // MAIN repo's @socketsecurity/lib-stable link). Same relink-from-store repair
  // as the gutted case, same guards.
  if (hasDanglingLibSymlink(paths.libStableLink)) {
    /* c8 ignore start - repair/guard branches depend on live machine state + subprocess spawning; subprocess tests cover them */
    if (existsSync(paths.repairSentinel)) {
      return notify(
        '[broken-hook-detector] node_modules has a dangling @socketsecurity/lib-stable symlink (a removed git worktree orphaned it) and auto-repair was already attempted this session. Run manually:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
    }
    if (pnpmInstallRunning()) {
      return notify(
        '[broken-hook-detector] node_modules has a dangling @socketsecurity/lib-stable symlink but a `pnpm install` is already running — not starting a second (collision risk). If it finishes without restoring, run:\n' +
          '  rm node_modules/.pnpm-workspace-state-v1.json node_modules/.modules.yaml && CI=true pnpm install',
      )
    }
    return notify(`[broken-hook-detector] ${repairGutted(paths)}`)
    /* c8 ignore stop */
  }

  const entrypoints = findHookEntrypoints(paths.hooksDir)
  if (entrypoints.length === 0) {
    return undefined
  }
  const failures: ProbeFailure[] = []
  /* c8 ignore start - probeHook spawns a subprocess per hook; subprocess tests cover this */
  for (const entry of entrypoints) {
    const failure = probeHook(entry, projectDir)
    if (failure !== undefined) {
      failures.push(failure)
    }
  }
  if (failures.length === 0) {
    return undefined
  }
  return notify(`[broken-hook-detector] ${formatReport(failures, projectDir)}`)
  /* c8 ignore stop */
}

export const hook = defineHook({
  check,
  event: 'SessionStart',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
