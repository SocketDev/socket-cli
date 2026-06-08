#!/usr/bin/env node
/**
 * @file `check --all` gate: assert every package manager the fleet uses to
 *   install tooling has auto-update DISABLED on this machine. An auto-updating
 *   manager (`brew` / `choco` / `winget` / `scoop` / `npm` / `pnpm`) can change
 *   a tool's version underneath a build / scan, add latency, or pull an
 *   unsoaked package — a reproducibility + supply-chain hazard. The knob lives
 *   outside the repo (env vars, npmrc, chocolatey.config, winget settings) so
 *   it drifts per machine; this gate catches the drift.
 *
 *   Shares ALL detection logic with the point-of-use
 *   `.claude/hooks/fleet/package-manager-auto-update-guard/` and the
 *   `setup-security-tools` installer via `_shared/package-manager-auto-update.mts`
 *   (code is law, DRY — the three never diverge).
 *
 *   A manager that isn't installed (`absent`) is informational, never a
 *   failure — CI runners legitimately lack brew/choco. Exit codes: 0 — every
 *   installed manager has auto-update disabled (or none installed); 1 — at
 *   least one installed manager still has auto-update enabled (drift). The fix
 *   per manager is printed; `setup-security-tools` sets them all.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { auditCurrentPlatform } from '../../../.claude/hooks/fleet/_shared/package-manager-auto-update.mts'

const logger = getDefaultLogger()

const results = auditCurrentPlatform()
const enabled = results.filter(r => r.state === 'enabled')
const disabled = results.filter(r => r.state === 'disabled')
const absent = results.filter(r => r.state === 'absent')

for (let i = 0, { length } = disabled; i < length; i += 1) {
  logger.log(`  ok  ${disabled[i]!.id}: ${disabled[i]!.reason}`)
}
for (let i = 0, { length } = absent; i < length; i += 1) {
  logger.log(`  --  ${absent[i]!.id}: ${absent[i]!.reason} (not applicable)`)
}

if (enabled.length === 0) {
  logger.log('package-manager auto-update: disabled on every installed manager.')
  process.exitCode = 0
} else {
  logger.error('')
  logger.error(
    `[package-manager-auto-update] ${enabled.length} manager(s) still auto-update:`,
  )
  for (let i = 0, { length } = enabled; i < length; i += 1) {
    const r = enabled[i]!
    logger.error(`  ✗ ${r.id}: ${r.reason}`)
    logger.error(`    fix: ${r.fix}`)
  }
  logger.error('')
  logger.error(
    '  Or run the installer that sets every knob:',
  )
  logger.error(
    '    node .claude/hooks/fleet/setup-security-tools/install.mts',
  )
  process.exitCode = 1
}
