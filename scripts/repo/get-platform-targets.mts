#!/usr/bin/env node
/**
 * Output platform targets for shell scripts. Used by publish workflow to
 * iterate over platforms.
 *
 * Usage: node scripts/get-platform-targets.mts.
 *
 * # Outputs space-separated: linux-x64 linux-arm64 ...
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PLATFORM_TARGETS } from '../../packages/build-infra/lib/platform-targets.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'

import type { ScriptMeta } from '../fleet/process/run-main.mts'

const logger = getDefaultLogger()

export function main(): void {
  logger.log(PLATFORM_TARGETS.join(' '))
}

const SCRIPT_META: ScriptMeta = {
  describe: 'print the supported platform targets for shell scripts',
  help: 'Usage: node scripts/repo/get-platform-targets.mts [--json]',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
