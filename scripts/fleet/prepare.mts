#!/usr/bin/env node
/**
 * @file `prepare` lifecycle orchestrator. Runs after `pnpm install` completes.
 *   Kept as a script (not inline in package.json) so it can be tested, linted,
 *   and updated by the wheelhouse cascade. Steps:
 *
 *   1. Install fleet git hooks.
 *   2. Auto-apply the latest fleet scaffolding release if one is available and
 *      lock-step allows. This is fail-open: a missing `gh` CLI or network blip
 *      logs a warning and does not block the install.
 *
 *   Usage: node scripts/fleet/prepare.mts
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

async function run(
  label: string,
  cmd: string,
  args: string[],
): Promise<boolean> {
  try {
    await spawn(cmd, args, { stdio: 'inherit' })
    return true
  } catch (error) {
    logger.error(`${label} failed: ${errorMessage(error)}`)
    return false
  }
}

async function main(): Promise<void> {
  const ok = await run(
    'install-git-hooks',
    'node',
    ['scripts/fleet/install-git-hooks.mts'],
  )
  if (!ok) {
    process.exitCode = 1
    return
  }

  // Fail-open: a network/gh outage during install must not block development.
  const updateOk = await run(
    'fleet:update',
    'node',
    ['bootstrap/fleet.mjs', '--update'],
  )
  if (!updateOk) {
    logger.warn(
      'fleet:update reported a problem; continuing with install. Run `pnpm run fleet:update` manually when connectivity returns.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(error => {
    logger.error(`prepare failed: ${errorMessage(error)}`)
    process.exitCode = 1
  })
}
