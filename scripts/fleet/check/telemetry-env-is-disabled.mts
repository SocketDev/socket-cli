#!/usr/bin/env node
/**
 * @file `check --all` gate: assert the universal fleet no-phone-home env
 *   (`FLEET_ENV`) is set in the current environment. These knobs disable
 *   telemetry + update-notifier phone-homes across npm, pnpm, Claude Code, and
 *   any `DO_NOT_TRACK`-honoring tool. `setup-security-tools` persists them into
 *   the dev shell-rc; the reusable CI workflow sets them in its `env:`. This
 *   gate catches an environment where one is missing (a dev machine not yet set
 *   up, or a CI job whose workflow env lacks them) — i.e. where a phone-home
 *   could slip through. Reads the SAME `FLEET_ENV` source of truth the shell-rc
 *   bridge and the CI workflow env derive from (code is law, DRY). Exit 1 on
 *   any knob not set to its expected value; the pure `findUnsetFleetEnv` is
 *   exported so the test drives it without the process-env dependency.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { FLEET_ENV } from '../../../.claude/hooks/fleet/_shared/fleet-env.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface FleetEnvViolation {
  name: string
  expected: string
  actual: string | undefined
}

// Pure: the FLEET_ENV knobs not set to their expected value in `env`.
export function findUnsetFleetEnv(env: NodeJS.ProcessEnv): FleetEnvViolation[] {
  const violations: FleetEnvViolation[] = []
  for (let i = 0, { length } = FLEET_ENV; i < length; i += 1) {
    const knob = FLEET_ENV[i]!
    const actual = env[knob.name]
    if (actual !== knob.value) {
      violations.push({ actual, expected: knob.value, name: knob.name })
    }
  }
  return violations
}

async function main(): Promise<void> {
  const violations = findUnsetFleetEnv(process.env)
  if (violations.length === 0) {
    logger.success('Fleet no-phone-home env is set (FLEET_ENV).')
    return
  }
  logger.fail(
    `[telemetry-env-is-disabled] ${violations.length} fleet env knob(s) not set:`,
  )
  logger.log('')
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    const got = v.actual === undefined ? '(unset)' : `'${v.actual}'`
    logger.log(`  ✗ ${v.name}: expected '${v.expected}', got ${got}`)
  }
  logger.log('')
  logger.log('  These disable telemetry / update-notifier phone-homes.')
  logger.log(
    '  Fix (dev):  node .claude/hooks/fleet/setup-security-tools/install.mts',
  )
  logger.log(
    '  Fix (CI):   the reusable CI workflow sets FLEET_ENV in its env:.',
  )
  process.exitCode = 1
}

// Entrypoint-guarded so the test imports findUnsetFleetEnv without triggering
// the process.env read (the check runs as a standalone `node` entrypoint).
if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    logger.fail('telemetry-env-is-disabled check failed:', error)
    process.exitCode = 1
  })
}
