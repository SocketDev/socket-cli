/**
 * @file Shared core for the fleet cache CLIs (restore.mts / save.mts) — the
 *   native port of the `actions/cache` composite steps over the first-party
 *   cache-service client in ./client.mts. Pure decision functions — arg
 *   parsing, key matching, output-line composition — are exported for the
 *   wheelhouse unit suite; the impure residue (file appends, the service
 *   calls behind the injectable ActionsCacheModule seam) stays thin. The
 *   CLIs run on both sides of `pnpm install`: the pnpm-store restore runs
 *   BEFORE install, and the Rust-only jobs never install — that works
 *   because @socketsecurity/lib-stable (the only package dependency in this
 *   family) is provisioned pre-pnpm by setup/bootstrap-zero-dep-packages.mjs,
 *   the same dep-0 bootstrap every fleet setup composite runs first.
 */

import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// The subset of the cache-service client surface the CLIs call —
// ./client.mts satisfies it, and the unit suites inject mocks shaped like it.
export interface ActionsCacheModule {
  restoreCache(
    paths: string[],
    primaryKey: string,
    restoreKeys?: string[] | undefined,
  ): Promise<string | undefined>
  saveCache(paths: string[], key: string): Promise<number>
}

// Parsed CLI surface shared by restore and save. `restoreKeys` is always
// present and empty for save — the parser rejects the flag there.
export interface CacheCliArgs {
  key: string
  paths: string[]
  restoreKeys: string[]
}

export interface CacheCliParseResult {
  args?: CacheCliArgs | undefined
  usageError?: string | undefined
}

// Default stdout sink for the CLIs.
export function logCacheCliLine(message: string): void {
  logger.log(message)
}

// Default stderr sink for the CLIs' loud failures.
export function logCacheCliError(message: string): void {
  logger.error(message)
}

/**
 * Expand repeatable flag values: each value may itself be a newline-separated
 * list, because the composite actions pass step outputs composed one path
 * per line. Entries are trimmed; empties drop out.
 */
export function expandFlagValues(values: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0, { length } = values; i < length; i += 1) {
    const parts = values[i]!.split('\n')
    for (let j = 0, partCount = parts.length; j < partCount; j += 1) {
      const entry = parts[j]!.trim()
      if (entry !== '') {
        out.push(entry)
      }
    }
  }
  return out
}

/**
 * Parse the shared CLI surface: repeatable `--path`, one `--key`, and (for
 * restore only) repeatable `--restore-key`. Returns a usage error string
 * instead of throwing so the CLI shells own the exit code.
 */
export function parseCacheCliArgs(
  argv: readonly string[],
  config: { allowRestoreKeys: boolean; command: string },
): CacheCliParseResult {
  const cfg = { __proto__: null, ...config }
  const restoreKeyHint = cfg.allowRestoreKeys
    ? ' [--restore-key <prefix>]...'
    : ''
  const usage = `Usage: node scripts/fleet/cache/${cfg.command}.mts --path <path>... --key <key>${restoreKeyHint}`
  let parsed: {
    values: {
      key?: string | undefined
      path?: string[] | undefined
      'restore-key'?: string[] | undefined
    }
  }
  try {
    parsed = parseArgs({
      allowPositionals: false,
      args: [...argv],
      options: {
        key: { type: 'string' },
        path: { multiple: true, type: 'string' },
        'restore-key': { multiple: true, type: 'string' },
      },
      strict: true,
    })
  } catch (e) {
    return {
      usageError: `Unrecognized arguments for the fleet cache ${cfg.command} CLI. Saw: ${errorMessage(e)}. Fix: ${usage}`,
    }
  }
  const paths = expandFlagValues(parsed.values.path ?? [])
  const restoreKeys = expandFlagValues(parsed.values['restore-key'] ?? [])
  const key = (parsed.values.key ?? '').trim()
  if (paths.length === 0) {
    return {
      usageError: `No cache paths given to the fleet cache ${cfg.command} CLI. Saw: zero --path values. Fix: ${usage}`,
    }
  }
  if (key === '') {
    return {
      usageError: `No cache key given to the fleet cache ${cfg.command} CLI. Saw: an empty --key. Fix: ${usage}`,
    }
  }
  if (!cfg.allowRestoreKeys && restoreKeys.length > 0) {
    return {
      usageError: `--restore-key is a restore-only flag; the fleet cache ${cfg.command} CLI saves under exactly one key. Saw: ${restoreKeys.length} --restore-key value(s). Fix: ${usage}`,
    }
  }
  return { args: { key, paths, restoreKeys } }
}

/**
 * Whether the restored key is an exact match for the primary key — the
 * `cache-hit` verdict. Case-insensitive, mirroring the upstream
 * actions/cache behavior (the cache service treats keys case-insensitively).
 */
export function isExactKeyMatch(
  primaryKey: string,
  matchedKey: string | undefined,
): boolean {
  return (
    matchedKey !== undefined &&
    matchedKey.toLowerCase() === primaryKey.toLowerCase()
  )
}

/**
 * The GITHUB_OUTPUT lines a restore emits — the same three outputs the
 * upstream actions/cache/restore action publishes, which the fleet
 * composites consume (`cache-hit` in cache-pnpm-store, `cache-matched-key`
 * in setup-odai). A miss writes an empty matched key and a false hit, never
 * nothing — downstream `if:` expressions compare against ''.
 */
export function composeRestoreOutputLines(
  primaryKey: string,
  matchedKey: string | undefined,
): string[] {
  return [
    `cache-primary-key=${primaryKey}`,
    `cache-matched-key=${matchedKey ?? ''}`,
    `cache-hit=${isExactKeyMatch(primaryKey, matchedKey)}`,
  ]
}

/**
 * Append `k=v` lines to the step's GITHUB_OUTPUT file when the variable is
 * set; outside GitHub Actions (a local run) the outputs are simply not
 * written — stdout already carries the verdict.
 */
export function appendGithubOutputLines(
  lines: readonly string[],
  options?:
    | {
        appendFile?: ((file: string, data: string) => void) | undefined
        env?: Record<string, string | undefined> | undefined
      }
    | undefined,
): void {
  const opts = { __proto__: null, ...options }
  const env = opts.env ?? process.env
  const file = env['GITHUB_OUTPUT']
  if (!file) {
    return
  }
  const appendFile =
    opts.appendFile ??
    ((target: string, data: string) => appendFileSync(target, data))
  for (let i = 0, { length } = lines; i < length; i += 1) {
    appendFile(file, `${lines[i]!}\n`)
  }
}
