/**
 * @file Fleet cache save CLI — the native port of the `actions/cache/save`
 *   step over the `@actions/cache` package. Saves the given paths under one
 *   key. Idempotent on the reserve conflict: when the service reports the
 *   key already exists or another job holds the reservation
 *   (ReserveCacheError), that is a success with a note — the entry the
 *   caller wanted cached IS cached (or about to be) — mirroring how the
 *   upstream action treats an already-saved key as a no-op. Every OTHER
 *   service error is loud — What / Where / Saw-vs-wanted / Fix and a
 *   non-zero exit. Usage:
 *   node scripts/fleet/cache/save.mts --path <path>... --key <key>
 */

import process from 'node:process'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  cacheErrorText,
  loadActionsCacheModule,
  logCacheCliError,
  logCacheCliLine,
  parseCacheCliArgs,
} from './cache-cli.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import type { ActionsCacheModule } from './cache-cli.mts'

// The reserve-conflict error class name thrown by @actions/cache when the
// key is already reserved or saved. Matched by name (not instanceof) so the
// verdict holds whichever module tier — repo node_modules or the provisioned
// scratch prefix — produced the instance.
export const RESERVE_CACHE_ERROR_NAME = 'ReserveCacheError'

export function isReserveConflict(thrown: unknown): boolean {
  return thrown instanceof Error && thrown.name === RESERVE_CACHE_ERROR_NAME
}

export interface CacheSaveDeps {
  loadModule?: (() => Promise<ActionsCacheModule>) | undefined
  log?: ((message: string) => void) | undefined
  logError?: ((message: string) => void) | undefined
}

/**
 * Run the save: parse argv, load the module, save. Returns the process exit
 * code. Dependencies are injectable so the unit suite drives it end-to-end
 * with a mocked cache service.
 */
export async function runCacheSave(
  argv: readonly string[],
  deps?: CacheSaveDeps | undefined,
): Promise<number> {
  const log = deps?.log ?? logCacheCliLine
  const logError = deps?.logError ?? logCacheCliError
  const { args, usageError } = parseCacheCliArgs(argv, {
    allowRestoreKeys: false,
    command: 'save',
  })
  if (!args) {
    logError(usageError ?? 'Unusable arguments.')
    return 1
  }
  try {
    const loadModule = deps?.loadModule ?? loadActionsCacheModule
    const cacheModule = await loadModule()
    await cacheModule.saveCache([...args.paths], args.key)
  } catch (e) {
    if (isReserveConflict(e)) {
      log(
        `Cache already exists for key: ${args.key} (another job saved or reserved it) — nothing to do.`,
      )
      return 0
    }
    logError(
      `Cache save failed. Where: the cache service, key '${args.key}'. Saw: ${cacheErrorText(e)}; wanted a saved entry. Fix: re-run the job; if it persists, check GitHub Actions cache service status and that the paths exist on disk.`,
    )
    return 1
  }
  log(`Cache saved with key: ${args.key}`)
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe: 'saves the given paths to the GitHub Actions cache under one key',
  help: `Usage: node scripts/fleet/cache/save.mts --path <path>... --key <key>

  --path <path>  a path to cache (repeatable; a value may be a newline-separated list)
  --key <key>    the cache key to save under`,
}

if (isMainModule(import.meta.url)) {
  runMain(() => runCacheSave(process.argv.slice(2)), SCRIPT_META)
}
