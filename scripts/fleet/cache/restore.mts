/**
 * @file Fleet cache restore CLI — the native port of the
 *   `actions/cache/restore` step over the `@actions/cache` package. Restores
 *   the given paths from the cache service and mirrors the upstream action's
 *   outputs on GITHUB_OUTPUT (`cache-primary-key`, `cache-matched-key`,
 *   `cache-hit`), which the fleet composites consume: cache-pnpm-store reads
 *   `cache-hit`, setup-odai gates its model fill on `cache-matched-key`.
 *   A cache MISS is a normal result (exit 0, empty matched key); a service
 *   error is loud — What / Where / Saw-vs-wanted / Fix and a non-zero exit —
 *   because a silently skipped restore reads as "CI got slower", never as a
 *   failure. Usage:
 *   node scripts/fleet/cache/restore.mts --path <path>... --key <key>
 *   [--restore-key <prefix>]...
 */

import process from 'node:process'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import {
  appendGithubOutputLines,
  cacheErrorText,
  composeRestoreOutputLines,
  isExactKeyMatch,
  loadActionsCacheModule,
  logCacheCliError,
  logCacheCliLine,
  parseCacheCliArgs,
} from './cache-cli.mts'

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
    const loadModule = deps?.loadModule ?? loadActionsCacheModule
    const cacheModule = await loadModule()
    matchedKey = await cacheModule.restoreCache([...args.paths], args.key, [
      ...args.restoreKeys,
    ])
  } catch (e) {
    logError(
      `Cache restore failed. Where: the cache service, key '${args.key}'. Saw: ${cacheErrorText(e)}; wanted a restored entry or a clean miss. Fix: re-run the job; if it persists, check GitHub Actions cache service status and the job's ACTIONS_RESULTS_URL wiring.`,
    )
    return 1
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

if (isMainModule(import.meta.url)) {
  runMain(() => runCacheRestore(process.argv.slice(2)), SCRIPT_META)
}
