import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_CACHE_DIR } from './cli-build/constants/paths.mts'
import { isMainModule } from '../fleet/process/is-main-module.mts'
import { runMain } from '../fleet/process/run-main.mts'
import type { ScriptMeta } from '../fleet/process/run-main.mts'

const logger = getDefaultLogger()

export async function cleanCliCache(
  options: { cacheDir?: string | undefined; dryRun?: boolean | undefined } = {},
): Promise<void> {
  const { cacheDir = REPO_CACHE_DIR, dryRun = false } = options
  if (!existsSync(cacheDir)) {
    return
  }
  if (dryRun) {
    logger.log(`Would remove ${cacheDir}`)
    return
  }
  await safeDelete(cacheDir)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } })
  await cleanCliCache({ dryRun: values['dry-run'] ?? false })
}

const SCRIPT_META: ScriptMeta = {
  describe: 'clean the repository CLI cache',
  help: 'Usage: pnpm run clean:cache [--dry-run]',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
