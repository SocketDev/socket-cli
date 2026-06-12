#!/usr/bin/env node
/**
 * @file `check --all` gate: assert every macOS GUI app the fleet uses for
 *   tooling that ships a Sparkle auto-updater (e.g. OrbStack) has auto-update
 *   DISABLED on this machine. A Sparkle app that auto-updates can swap a tool
 *   version under a running build / scan and rides its own update channel
 *   outside the fleet soak gate — a reproducibility + supply-chain hazard. The
 *   knob lives in the app's macOS defaults domain (outside the repo), so it
 *   drifts per machine; this gate catches the drift.
 *
 *   Shares ALL detection with setup-security-tools (which writes the disable)
 *   via `_shared/sparkle-auto-update.mts` (code is law, DRY — the two never
 *   diverge). There is no PreToolUse guard twin: a Sparkle app self-updates with
 *   no Bash invocation to gate, so persist + audit are the enforcement surfaces.
 *
 *   An app not installed / never launched (`absent`) is informational, never a
 *   failure — CI runners + Linux lack these GUI apps. Exit codes: 0 — every
 *   detected app has auto-update disabled (or none present); 1 — at least one is
 *   still auto-updating. The fix is printed; setup-security-tools sets it.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  auditSparkleApps,
  SPARKLE_DISABLE_KEYS,
} from '../../../.claude/hooks/fleet/_shared/sparkle-auto-update.mts'

const logger = getDefaultLogger()

const results = auditSparkleApps()
const enabled = results.filter(r => r.state === 'enabled')

for (let i = 0, { length } = results; i < length; i += 1) {
  const r = results[i]!
  if (r.state === 'disabled') {
    logger.log(`  ok  ${r.id}: ${r.reason}`)
  } else if (r.state === 'absent') {
    logger.log(`  --  ${r.id}: ${r.reason} (not applicable)`)
  }
}

if (enabled.length === 0) {
  logger.log('sparkle auto-update: disabled on every detected app.')
  process.exitCode = 0
} else {
  logger.error('')
  logger.error(
    `[sparkle-auto-update] ${enabled.length} app(s) still auto-update:`,
  )
  for (let i = 0, { length } = enabled; i < length; i += 1) {
    const r = enabled[i]!
    logger.error(`  ✗ ${r.id}: ${r.reason}`)
    for (let j = 0, klen = SPARKLE_DISABLE_KEYS.length; j < klen; j += 1) {
      logger.error(
        `    fix: defaults write ${r.domain} ${SPARKLE_DISABLE_KEYS[j]!} -bool false`,
      )
    }
  }
  logger.error('')
  logger.error('  Or run the installer that sets every knob:')
  logger.error('    node .claude/hooks/fleet/setup-security-tools/install.mts')
  process.exitCode = 1
}
