#!/usr/bin/env node
/*
 * @file Setup step — build the per-machine V8 startup-snapshot fast path for the
 *   fleet hook dispatcher, and (on POSIX) wire the live `.claude/settings.json`
 *   dispatch commands at the native launcher.
 *
 *   THE LAYERS, and why this step exists.
 *
 *   The cascaded, fleet-canonical `settings.json` points every dispatch event at
 *   `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/fleet/_dispatch/index.cjs <Event>`
 *   — the V8 COMPILE-CACHE path. That bundle (`index.cjs` → `bundle.cjs`) holds
 *   the COMPLETE 190-hook set and is correct on every OS/arch with zero
 *   per-machine state, so it is the always-safe baseline that ships to every
 *   fleet repo. It is also the launcher's own fail-open target.
 *
 *   On top of that baseline this step adds the faster path for THIS machine:
 *
 *     1. Rebuild the production bundle (`index.cjs`/`bundle.cjs`), the snapshot
 *        bundle, and the runtime-keyed blob, so the compile-cache baseline is
 *        current and a matching blob exists for the host node × arch × V8 tag.
 *     2. Compile the native launcher for the HOST os/arch + freeze its sidecars
 *        (`node.path`, `snapshot-blob.path`).
 *     3. POSIX: rewrite the LIVE `.claude/settings.json` dispatch commands to the
 *        launcher binary. The launcher re-execs `node --snapshot-blob <blob>
 *        <Event>` in ONE process transition (`execv` replaces the launcher image
 *        — no parent node, no second resident process), and FAILS OPEN to
 *        `node index.cjs <Event>` (the compile-cache baseline) on any
 *        missing/blank sidecar, a vanished/mismatched blob, or any error. So the
 *        wired fast path is byte-equivalent to the baseline and never less
 *        correct — worst case is the (complete, correct) compile-cache path.
 *
 *     4. WINDOWS: there is no image-replacing `execv`; the launcher
 *        `CreateProcess`es node + waits, keeping a thin native parent resident.
 *        Whether that still beats the single-process compile-cache path is a
 *        Windows-CI question (CreateProcess is heavier than execv). So by DEFAULT
 *        this step builds the `.exe` launcher but LEAVES settings on the
 *        compile-cache baseline; pass `--win-launcher` to wire the `.exe` once CI
 *        confirms the win. Correctness is identical either way via fail-open.
 *
 *   IDEMPOTENT + cascade-aware. The launcher command is per-machine state that
 *   the FLEET cascade does not know about: a cascade rewrites `settings.json` to
 *   `merge(template, repo-hooks)`, which reverts the dispatch commands to the
 *   compile-cache baseline. That revert is SAFE (it lands on the correct
 *   baseline, never a broken state) — re-run this step after a cascade to
 *   restore the launcher fast path. Re-running with the launcher already wired is
 *   a no-op.
 *
 *   Usage:
 *     node scripts/fleet/setup/hook-snapshot.mts                # build + wire (POSIX)
 *     node scripts/fleet/setup/hook-snapshot.mts --win-launcher # also wire on Windows
 *     node scripts/fleet/setup/hook-snapshot.mts --no-wire      # build only, don't touch settings
 *     node scripts/fleet/setup/hook-snapshot.mts --unwire       # revert live settings to the baseline
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  baselineCommand,
  isDispatchCommand,
  launcherCommand,
  rewriteDispatchCommands,
} from '../../../bootstrap/src/dispatch-wiring.mts'
import type { DispatchSettings } from '../../../bootstrap/src/dispatch-wiring.mts'
import { DISPATCH_DIR, REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const SETTINGS_PATH = path.join(REPO_ROOT, '.claude', 'settings.json')

// The baseline/launcher command vocabulary + the idempotent dispatch rewrite are
// the SINGLE source in bootstrap/src/dispatch-wiring.mts — shared verbatim with
// the cascade merge (settings.mts), so the launcher form this step writes is the
// exact form the merge PRESERVES and the drift check CANONICALIZES. Re-exported
// at the bottom for the setup unit test.

/**
 * Run a build script with the host node; returns true on exit 0.
 */
function build(scriptRel: string, extraArgs: string[] = []): boolean {
  const r = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, scriptRel), ...extraArgs],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  return r.status === 0
}

function wireSettings(make: (event: string) => string, label: string): boolean {
  if (!existsSync(SETTINGS_PATH)) {
    logger.warn(`.claude/settings.json absent — skipping the ${label} wire.`)
    return false
  }
  let settings: DispatchSettings
  try {
    settings = JSON.parse(
      readFileSync(SETTINGS_PATH, 'utf8'),
    ) as DispatchSettings
  } catch (e) {
    logger.error(`.claude/settings.json is not valid JSON: ${String(e)}.`)
    return false
  }
  const changed = rewriteDispatchCommands(settings, make)
  if (changed === 0) {
    logger.success(`Hook dispatch already wired to the ${label}.`)
    return true
  }
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`)
  logger.success(
    `Wired ${changed} dispatch command(s) to the ${label}. ` +
      `Restart Claude Code for it to take effect.`,
  )
  return true
}

function main(): void {
  const argv = process.argv.slice(2)
  const noWire = argv.includes('--no-wire')
  const winLauncher = argv.includes('--win-launcher')
  const wireLauncher = argv.includes('--wire-launcher')
  const unwire = argv.includes('--unwire')
  const isWin = process.platform === 'win32'

  // --unwire is a pure settings revert (no rebuild) — restore the baseline.
  if (unwire) {
    wireSettings(baselineCommand, 'compile-cache baseline')
    return
  }

  logger.log(
    'Building the hook compile-cache bundle + snapshot blob + launcher…',
  )
  if (!build('scripts/fleet/build-hook-bundle.mts')) {
    logger.error('Production bundle build failed.')
    process.exitCode = 1
    return
  }
  if (!build('scripts/fleet/build-hook-snapshot.mts')) {
    logger.error('Snapshot bundle/blob build failed.')
    process.exitCode = 1
    return
  }
  if (!build('scripts/fleet/build-snapshot-launcher.mts')) {
    // A launcher build failure is non-fatal: the compile-cache baseline is the
    // correct path with or without the launcher, so leave settings alone and
    // report — do not wedge setup.
    logger.warn(
      'Launcher build failed — staying on the compile-cache baseline (correct, ' +
        'just without the per-machine snapshot fast path).',
    )
    return
  }

  if (noWire) {
    logger.log('--no-wire: built artifacts, leaving settings.json untouched.')
    return
  }

  const launcherBin = path.join(
    DISPATCH_DIR,
    isWin ? 'dispatch-launcher.exe' : 'dispatch-launcher',
  )
  if (!existsSync(launcherBin)) {
    logger.warn(
      `Launcher binary missing at ${launcherBin}; staying on the compile-cache baseline.`,
    )
    return
  }

  if (isWin && !winLauncher) {
    // Phase-1 verdict: the Windows launcher keeps a resident native parent
    // (CreateProcess + wait, no execv), so whether it beats the single-process
    // compile-cache path is CI-confirm-only. Default to the baseline; opt in
    // with --win-launcher once Windows CI confirms the win.
    logger.log(
      'Windows: built the launcher but staying on the compile-cache baseline ' +
        '(pass --win-launcher to wire it once CI confirms the win).',
    )
    return
  }

  if (!wireLauncher) {
    // The launcher is a per-machine V8-snapshot fast path — a marginal win over
    // the always-present compile-cache baseline. Pinning it into the TRACKED
    // settings.json is FRAGILE: EDR / cleanup reaps the launcher binary, and the
    // committed dispatch then points at an absent file → every hook fails open
    // (guards inert, fleet-wide, silently). Default to the resilient baseline;
    // opt in with --wire-launcher only on a machine where the launcher persists.
    logger.log(
      'Built the launcher; staying on the compile-cache baseline (pass ' +
        '--wire-launcher to pin the per-machine snapshot fast path).',
    )
    return
  }
  wireSettings(launcherCommand, 'snapshot launcher')
}

if (process.argv[1]?.endsWith('hook-snapshot.mts')) {
  main()
}

export {
  baselineCommand,
  isDispatchCommand,
  launcherCommand,
  rewriteDispatchCommands,
}
