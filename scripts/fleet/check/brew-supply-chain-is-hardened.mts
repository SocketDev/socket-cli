#!/usr/bin/env node
/**
 * @file `check --all` gate: assert this machine's Homebrew is hardened to the
 *   6.0.0 supply-chain posture — installed brew >= 6.0.0 AND the two opt-in
 *   controls (HOMEBREW_REQUIRE_TAP_TRUST, HOMEBREW_CASK_OPTS_REQUIRE_SHA) are
 *   set. An older or unhardened brew can evaluate untrusted third-party tap
 *   code or install an unchecksummed cask — a supply-chain hazard. The env
 *   knobs live outside the repo (shell rc), so they drift per machine; this
 *   gate catches the drift. Shares ALL detection with the point-of-use
 *   `.claude/hooks/fleet/brew-supply-chain-guard/` and the
 *   `setup-security-tools` installer via `_shared/brew-supply-chain.mts` (code
 *   is law, DRY — the three never diverge). A machine without brew (`absent`)
 *   is informational, never a failure — CI runners legitimately lack brew. Exit
 *   codes: 0 — brew hardened (or absent); 1 — brew present but unhardened
 *   (drift). The fix is printed; `setup-security-tools` sets the env knobs,
 *   `brew upgrade` clears the floor.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  BREW_MIN_VERSION,
  detectBrewSecurity,
} from '../../../.claude/hooks/fleet/_shared/brew-supply-chain.mts'

const logger = getDefaultLogger()

const status = detectBrewSecurity()

if (status.state === 'absent') {
  logger.log('  --  homebrew: brew not on PATH (not applicable)')
  process.exitCode = 0
} else if (status.state === 'hardened') {
  logger.log(`  ok  homebrew: ${status.reason}`)
  process.exitCode = 0
} else {
  logger.error('')
  logger.error(`[brew-supply-chain] Homebrew is not hardened: ${status.reason}`)
  if (!status.versionOk) {
    logger.error(
      `    fix: brew update && brew upgrade  (to >= ${BREW_MIN_VERSION})`,
    )
  }
  for (let i = 0, { length } = status.missingEnv; i < length; i += 1) {
    const knob = status.missingEnv[i]!
    logger.error(`    fix: export ${knob.name}=1  — ${knob.protects}`)
  }
  logger.error('')
  logger.error('  Or run the installer that sets the env knobs:')
  logger.error('    node .claude/hooks/fleet/setup-security-tools/install.mts')
  process.exitCode = 1
}
