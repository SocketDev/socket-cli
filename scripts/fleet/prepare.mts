#!/usr/bin/env node
/*
 * @file prepare lifecycle orchestrator. Runs after pnpm install completes.
 *   Kept as a script (not inline in package.json) so it can be tested, linted,
 *   and updated by the wheelhouse cascade. Steps:
 *
 *   1. Install fleet git hooks.
 *
 *   Usage: node scripts/fleet/prepare.mts
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

export async function run(
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

export async function main(): Promise<void> {
  const ok = await run('install-git-hooks', 'node', [
    'scripts/fleet/install-git-hooks.mts',
  ])
  if (!ok) {
    process.exitCode = 1
    return
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(error => {
    logger.error(`prepare failed: ${errorMessage(error)}`)
    process.exitCode = 1
  })
}
