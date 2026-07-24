#!/usr/bin/env node
/*
 * @file Release-tier check: on a machine that has OPTED INTO the hook V8
 *   startup-snapshot fast path (the native `dispatch-launcher` exists), the
 *   snapshot must be WIRED + USED, not silently reverted to the compile-cache
 *   baseline. It asserts three things:
 *
 *     1. WIRED — every hook dispatch command in the LIVE `.claude/settings.json`
 *        points at `dispatch-launcher`, not `index.cjs`. A fleet
 *        cascade rewrites settings to `merge(template, repo-hooks)`, which
 *        reverts the dispatch commands to the baseline — safe, but it silently
 *        DROPS the fast path. This fails loud so the operator re-runs setup.
 *     2. BUILT + BOOTS — the snapshot bundle builds a blob with no
 *        snapshot-hostility bail, and a `node --snapshot-blob <blob>` process
 *        boots it directly (bypassing the launcher's fail-open, so a broken blob
 *        can't hide). A hook adding top-level SharedArrayBuffer / node:tty /
 *        eager-logger init breaks the build → the launcher would perma-fail-open
 *        to baseline with nothing red.
 *     3. PARITY — the snapshot dispatch is byte-identical (stdout+stderr+exit) to
 *        the baseline for probe payloads, so `used` never means `subtly wrong`.
 *
 *   Together, WIRED + BOOTS ⟹ the launcher (which prefers the blob and only
 *   fails open on error) actually runs the snapshot. Skips cleanly where the
 *   fast path was never set up (fresh checkout / CI / member) — there the
 *   portable baseline IS the correct dispatch path, so there's nothing to
 *   enforce. Heavy (build + boots), so it runs in the release/CI tier.
 *
 *   Opt in / re-wire: node scripts/fleet/setup/hook-snapshot.mts
 *   Usage: node scripts/fleet/check/hook-snapshot-is-wired.mts
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- a check main() is a sync CLI gate; build + boot run inline in sequence.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { DISPATCH_DIR, REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const LAUNCHER = path.join(DISPATCH_DIR, 'dispatch-launcher')
const SNAPSHOT_BUNDLE = path.join(DISPATCH_DIR, 'snapshot-bundle.cjs')
const INDEX_CJS = path.join(DISPATCH_DIR, 'index.cjs')
const SETTINGS = path.join(REPO_ROOT, '.claude', 'settings.json')
const BUILD_SNAPSHOT_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'fleet',
  'build-hook-snapshot.mts',
)

// Probe payloads for boot + parity. A benign Read fires no hook (pure boot
// proof); a mass-delete Bash command a `-guard` blocks deterministically
// (dispatch proof — no throttle/time nondeterminism). Snapshot output must equal
// baseline output for both.
const PROBES: ReadonlyArray<readonly [string, string]> = [
  [
    'PreToolUse',
    '{"tool_name":"Read","tool_input":{"file_path":"/tmp/probe"}}',
  ],
  ['PreToolUse', '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}'],
]

export interface DispatchOutcome {
  code: number | null
  out: string
}

/**
 * Run one dispatch through `nodeArgs` for `event` with `payload` on stdin.
 * Captures combined stdout+stderr + exit code — the full observable surface.
 */
export function dispatch(
  nodeArgs: readonly string[],
  event: string,
  payload: string,
): DispatchOutcome {
  const r = spawnSync('node', [...nodeArgs, event], {
    encoding: 'utf8',
    input: payload,
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

export function outcomesMatch(
  snapshot: DispatchOutcome,
  baseline: DispatchOutcome,
): boolean {
  return snapshot.code === baseline.code && snapshot.out === baseline.out
}

/**
 * True when the settings JSON routes hook dispatch through the snapshot
 * launcher (`dispatch-launcher`) — the durable "this machine is USING the fast
 * path" signal. False means dispatch is on the compile-cache baseline. Pure.
 */
export function settingsRoutesToLauncher(settingsText: string): boolean {
  return /dispatch-launcher/.test(settingsText)
}

/**
 * True for a fresh checkout that has never opted into the host fast path.
 */
export function isFreshSnapshotCheckout(config: {
  hasLauncher: boolean
  hasSnapshotBundle: boolean
  isCI: boolean
  wiredToLauncher: boolean
}): boolean {
  const cfg = { __proto__: null, ...config }
  return (
    !cfg.hasLauncher &&
    !cfg.hasSnapshotBundle &&
    (cfg.isCI || !cfg.wiredToLauncher)
  )
}

function main(): number {
  // Member without the snapshot infra: nothing to verify (the fast path isn't
  // shipped here — the portable compile-cache baseline is the only dispatch
  // path). Keeps the check from red-lighting a bare member checkout.
  if (!existsSync(BUILD_SNAPSHOT_SCRIPT) || !existsSync(INDEX_CJS)) {
    logger.log('[hook-snapshot-is-wired] no snapshot infra here — skipping.')
    return 0
  }

  // The DURABLE "wired" signal is the LIVE settings routing, not the gitignored
  // launcher binary (which is per-machine + rebuilt/reaped). If the live dispatch
  // routes through the launcher, this machine is USING the fast path.
  let settingsText = ''
  try {
    settingsText = readFileSync(SETTINGS, 'utf8')
  } catch {
    /* c8 ignore next - settings.json is a fleet invariant; unreadable is not a testable path here */
  }
  const wiredToLauncher = settingsRoutesToLauncher(settingsText)

  // Fresh checkout / CI: the portable compile-cache baseline is intentional.
  // Generated snapshot artifacts are gitignored, so their joint absence with
  // baseline settings means this host never opted in — there is nothing to
  // validate. A partial/opted-in setup still proceeds and fails loud below.
  if (
    isFreshSnapshotCheckout({
      hasLauncher: existsSync(LAUNCHER),
      hasSnapshotBundle: existsSync(SNAPSHOT_BUNDLE),
      isCI: getCI(),
      wiredToLauncher,
    })
  ) {
    logger.log(
      '[hook-snapshot-is-wired] fresh checkout on compile-cache baseline — skipping.',
    )
    return 0
  }

  // WIRING CONSISTENCY: settings routing to the launcher while its binary is
  // absent is WORSE than baseline — the live dispatch points at a missing
  // executable. Rebuild it. (The binary is gitignored + host-built by setup.)
  if (wiredToLauncher && !existsSync(LAUNCHER)) {
    logger.fail(
      '[hook-snapshot-is-wired] .claude/settings.json dispatch is wired to the ' +
        'snapshot launcher, but the launcher binary is MISSING — the live ' +
        'dispatch points at a non-existent executable. Rebuild it:\n' +
        '  node scripts/fleet/setup/hook-snapshot.mts',
    )
    return 1
  }

  // BUILT + BOOTS: rebuild the blob from the current bundle in an isolated tmp
  // dir and boot it DIRECTLY (bypassing the launcher's fail-open, so a hostile
  // bundle or broken blob can't hide behind a baseline fallback).
  if (!existsSync(SNAPSHOT_BUNDLE)) {
    logger.fail(
      '[hook-snapshot-is-wired] snapshot bundle missing — the launcher would ' +
        'fail open to baseline. Rebuild: node scripts/fleet/build-hook-snapshot.mts',
    )
    return 1
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hook-snapshot-wired-'))
  const blob = path.join(tmp, 'dispatch.blob')
  try {
    const build = spawnSync(
      'node',
      ['--snapshot-blob', blob, '--build-snapshot', SNAPSHOT_BUNDLE],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    if (build.status !== 0 || !existsSync(blob)) {
      logger.fail(
        '[hook-snapshot-is-wired] the snapshot BAILED to build — the bundle is ' +
          'snapshot-HOSTILE (a hook likely added top-level SharedArrayBuffer / ' +
          'node:tty / eager-logger init). The launcher would perma-fail-open to ' +
          `baseline.\n  --build-snapshot exit ${String(build.status)}\n` +
          `${build.stderr ? `  ${build.stderr.trim()}\n` : ''}` +
          '  Defer the module-eval work to first use (see the lazy-logger ' +
          'pattern in .claude/hooks/fleet/_shared/guard.mts).',
      )
      return 1
    }
    // 3. BOOTS + PARITY vs baseline for every probe.
    for (let i = 0, { length } = PROBES; i < length; i += 1) {
      const [event, payload] = PROBES[i]!
      const snap = dispatch(['--snapshot-blob', blob], event, payload)
      const base = dispatch([INDEX_CJS], event, payload)
      if (!outcomesMatch(snap, base)) {
        logger.fail(
          `[hook-snapshot-is-wired] snapshot dispatch DIVERGED from baseline ` +
            `for ${event} ${payload}:\n` +
            `  snapshot: exit ${String(snap.code)} — ${snap.out.trim() || '(no output)'}\n` +
            `  baseline: exit ${String(base.code)} — ${base.out.trim() || '(no output)'}`,
        )
        return 1
      }
    }
  } finally {
    safeDeleteSync(tmp)
  }

  if (!wiredToLauncher) {
    // The fast path builds + boots + is correct, but the live dispatch is still
    // on the baseline. Not a failure (baseline is valid + portable), but nudge
    // the operator to actually USE the snapshot they can run.
    logger.log(
      '[hook-snapshot-is-wired] snapshot builds + boots + parity, but dispatch ' +
        'is on the compile-cache BASELINE. Opt into the fast path:\n' +
        '  node scripts/fleet/setup/hook-snapshot.mts',
    )
    return 0
  }
  logger.log(
    '[hook-snapshot-is-wired] hook V8 snapshot is WIRED, builds, boots, and ' +
      'dispatches with baseline parity.',
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main()
}
