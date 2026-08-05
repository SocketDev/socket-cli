/**
 * @file Fleet cache save CLI — the native port of the `actions/cache/save`
 *   step over the first-party cache-service client (./client.mts). Saves the
 *   given paths under one key. Idempotent on the reserve conflict: when the
 *   service reports the key already exists or another job holds the
 *   reservation (ReserveCacheError), that is a success with a note — the
 *   entry the caller wanted cached IS cached (or about to be) — mirroring
 *   how the upstream action treats an already-saved key as a no-op. Every
 *   OTHER service error is loud — What / Where / Saw-vs-wanted / Fix and a
 *   non-zero exit. Usage:
 *   node scripts/fleet/cache/save.mts --path <path>... --key <key>
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  logCacheCliError,
  logCacheCliLine,
  parseCacheCliArgs,
} from './cache-cli.mts'
import { RESERVE_CACHE_ERROR_NAME, restoreCache, saveCache } from './client.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import type { ActionsCacheModule } from './cache-cli.mts'

export { RESERVE_CACHE_ERROR_NAME }

// The reserve conflict is matched by name (not instanceof) — the client
// raises a plain Error carrying the upstream error class's name.
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
    const loadModule =
      deps?.loadModule ??
      (() => Promise.resolve<ActionsCacheModule>({ restoreCache, saveCache }))
    const cacheModule = await loadModule()
    await cacheModule.saveCache([...args.paths], args.key)
  } catch (e) {
    if (isReserveConflict(e)) {
      log(
        `Cache already exists for key: ${args.key} (another job saved or reserved it) — nothing to do.`,
      )
      return 0
    }
    // A cache failure never fails the job — the next run rebuilds cold,
    // matching the upstream action's warn-and-continue contract.
    log(`⚠️ cache save skipped for key '${args.key}' — ${errorMessage(e)}`)
    return 0
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
