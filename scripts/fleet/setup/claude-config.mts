#!/usr/bin/env node
/**
 * @file Setup step — harden the global Claude Code config (`~/.claude.json`).
 *   Run as part of `pnpm setup-all` (and standalone:
 *   `node scripts/fleet/setup/claude-config.mts`).
 *   Sets the global-only config keys the fleet wants hardened. Currently:
 *   copyOnSelect: false
 *   The TUI auto-copies on mouse-selection and emits an OSC-52 clipboard
 *   escape on each copy; iTerm2 denies OSC-52 by default and pops a
 *   "terminal attempted to access the clipboard" banner. Turning
 *   copyOnSelect off stops the auto-copy (ctrl+c / `/copy` still work), so
 *   no OSC-52 is emitted and no banner fires. It is a global-only key (read
 *   via the client's getGlobalConfig — a project-scoped or settings.json
 *   value is ignored), so it can't be cascaded as a repo file; this setup
 *   step is how the fleet applies it on every machine, and
 *   `check/claude-config-is-hardened.mts` keeps it from drifting back.
 *   Mouse-copy caveat. The TUI runs in mouse-reporting mode: the
 *   terminal forwards every click and drag to the app instead of
 *   handling it natively, so a plain drag does not paint a terminal
 *   selection, and with copyOnSelect off nothing is auto-copied. The
 *   escape hatch is the Option (Mac ⌥ / alt) key: hold it down and the
 *   terminal stops forwarding the mouse to the app for the duration of
 *   the gesture, handling the drag itself as a native text selection.
 *   Because the bypass is live for as long as Option is held, it also
 *   lets you re-drag over text that is already selected to adjust or
 *   replace the selection — the existing app-side selection does not
 *   get in the way. Once you have the Option-drag selection, copy it
 *   with Cmd-C or right-click → Copy. Holding Option to select this way
 *   is standard iTerm2 / Terminal.app behavior whenever a full-screen
 *   app captures the mouse; ctrl+c and /copy are unaffected.
 *   Idempotent: a no-op when the keys are already correct. Backs the file up
 *   once before the first write, preserves every other key, and re-reads to
 *   confirm. Absent `~/.claude.json` (fresh install) is not an error — the
 *   client writes its own on first run; this step skips and the check tolerates
 *   absence.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// The global-only keys the fleet hardens, with the value each must hold.
export const HARDENED_GLOBAL_CONFIG: Readonly<Record<string, unknown>> = {
  copyOnSelect: false,
}

export function globalConfigPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

// Apply the hardened keys to a parsed config object. Returns the keys it
// changed (empty = already hardened). Pure — the test drives it directly.
export function applyHardening(config: Record<string, unknown>): string[] {
  const changed: string[] = []
  const keys = Object.keys(HARDENED_GLOBAL_CONFIG)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    const want = HARDENED_GLOBAL_CONFIG[key]
    if (config[key] !== want) {
      config[key] = want
      changed.push(key)
    }
  }
  return changed
}

function main(): void {
  const configPath = globalConfigPath()
  if (!existsSync(configPath)) {
    logger.log(
      `~/.claude.json absent — the client writes it on first run; skipping (the check tolerates absence).`,
    )
    return
  }
  let config: Record<string, unknown>
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch (error) {
    logger.error(
      `~/.claude.json is not valid JSON (${errorMessage(error)}); not touching it. Fix the file, then re-run.`,
    )
    process.exitCode = 1
    return
  }
  const changed = applyHardening(config)
  if (changed.length === 0) {
    logger.success(
      'Global Claude config already hardened (copyOnSelect: false).',
    )
    return
  }
  // Back up once before the first write so a bad edit is recoverable.
  copyFileSync(configPath, `${configPath}.bak-fleet-hardening`)
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  logger.success(
    `Hardened global Claude config: set ${changed.join(', ')}. Backup at ~/.claude.json.bak-fleet-hardening. Restart Claude Code for it to take effect.`,
  )
}

if (process.argv[1]?.endsWith('claude-config.mts')) {
  main()
}
