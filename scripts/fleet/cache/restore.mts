/**
 * @file Fleet cache restore CLI — the native port of the
 *   `actions/cache/restore` step over the first-party cache-service client
 *   (./client.mts). Restores the given paths from the cache service and
 *   mirrors the upstream action's outputs on GITHUB_OUTPUT
 *   (`cache-primary-key`, `cache-matched-key`, `cache-hit`), which the fleet
 *   composites consume: cache-pnpm-store reads `cache-hit`, setup-odai gates
 *   its model fill on `cache-matched-key`.
 *   A cache MISS is a normal result (exit 0, empty matched key); a service
 *   error is loud — What / Where / Saw-vs-wanted / Fix and a non-zero exit —
 *   because a silently skipped restore reads as "CI got slower", never as a
 *   failure. Usage:
 *   node scripts/fleet/cache/restore.mts --path <path>... --key <key>
 *   [--restore-key <prefix>]...
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import {
  appendGithubOutputLines,
  composeRestoreOutputLines,
  isExactKeyMatch,
  logCacheCliError,
  logCacheCliLine,
  parseCacheCliArgs,
} from './cache-cli.mts'
import { restoreCache, saveCache } from './client.mts'

import type { ActionsCacheModule } from './cache-cli.mts'

export interface CacheRestoreDeps {
  appendOutput?: ((lines: readonly string[]) => void) | undefined
  loadModule?: (() => Promise<ActionsCacheModule>) | undefined
  log?: ((message: string) => void) | undefined
  logError?: ((message: string) => void) | undefined
}

/**
 * Run the restore: parse argv, load the module, restore, publish outputs.
 * Returns the process exit code. Dependencies are injectable so the unit
 * suite drives it end-to-end with a mocked cache service.
 */
export async function runCacheRestore(
  argv: readonly string[],
  deps?: CacheRestoreDeps | undefined,
): Promise<number> {
  const log = deps?.log ?? logCacheCliLine
  const logError = deps?.logError ?? logCacheCliError
  const appendOutput =
    deps?.appendOutput ??
    ((lines: readonly string[]) => appendGithubOutputLines(lines))
  const { args, usageError } = parseCacheCliArgs(argv, {
    allowRestoreKeys: true,
    command: 'restore',
  })
  if (!args) {
    logError(usageError ?? 'Unusable arguments.')
    return 1
  }
  let matchedKey: string | undefined
  try {
    const loadModule =
      deps?.loadModule ??
      (() => Promise.resolve<ActionsCacheModule>({ restoreCache, saveCache }))
    const cacheModule = await loadModule()
    matchedKey = await cacheModule.restoreCache([...args.paths], args.key, [
      ...args.restoreKeys,
    ])
  } catch (e) {
    // A cache failure never fails the job — the step reports a miss and the
    // build proceeds cold, matching the upstream action's contract.
    log(`⚠️ cache restore skipped for key '${args.key}' — ${errorMessage(e)}`)
    appendOutput(composeRestoreOutputLines(args.key, undefined))
    return 0
  }
  appendOutput(composeRestoreOutputLines(args.key, matchedKey))
  if (matchedKey === undefined) {
    log(`Cache not found for key: ${args.key}`)
  } else {
    const exact = isExactKeyMatch(args.key, matchedKey)
    log(
      `Cache restored from key: ${matchedKey}${exact ? '' : ' (restore-key prefix match)'}`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'restore paths from the GitHub Actions cache service, mirroring actions/cache/restore outputs',
  help: `Usage: node scripts/fleet/cache/restore.mts --path <path>... --key <key> [flags]

  --path <path>          path to restore (repeatable, required)
  --key <key>            primary cache key (required)
  --restore-key <prefix> fallback key prefix (repeatable)`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => runCacheRestore(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
