import { appendFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { restoreCache, saveCache } from '@actions/cache'

export type CacheMode = 'restore' | 'save'

export interface CacheClient {
  restoreCache(
    paths: string[],
    key: string,
    restoreKeys?: string[],
  ): Promise<string | undefined>
  saveCache(paths: string[], key: string): Promise<number | undefined>
}

export interface CacheActionOptions {
  readonly mode: CacheMode
  readonly key: string
  readonly path: string
  readonly restoreKeys?: string[]
}

export interface CacheActionReporter {
  warning(message: string): void
  output(name: string, value: string): Promise<void>
}

export function seaDownloadBlobPath(home = os.homedir()): string {
  return path.join(home, '.cache', 'socket-sea', 'downloads', 'v1', 'blobs')
}

export function resolveBlobPath(input: string, home = os.homedir()): string {
  const expanded =
    input === '~' || input.startsWith('~/')
      ? path.join(home, input.slice(2))
      : path.resolve(input)
  if (path.resolve(expanded) !== seaDownloadBlobPath(home)) {
    throw new TypeError('SEA download cache path must target only the blob directory')
  }
  return expanded
}

export async function runCacheAction(
  options: CacheActionOptions,
  cache: CacheClient,
  reporter: CacheActionReporter,
): Promise<{ cacheHit: boolean }> {
  if (options.mode !== 'restore' && options.mode !== 'save') {
    throw new TypeError(`Unknown SEA download cache mode: ${options.mode}`)
  }
  if (!options.key || !options.path) {
    throw new TypeError('SEA download cache key and path are required')
  }
  const paths = [options.path]
  const cacheAccess = process.env['ACTIONS_CACHE_MODE']
  if (options.mode === 'restore') {
    if (cacheAccess === 'none' || cacheAccess === 'write-only') {
      await reporter.output('cache-hit', 'false')
      return { cacheHit: false }
    }
    try {
      const matchedKey = await cache.restoreCache(
        paths,
        options.key,
        options.restoreKeys,
      )
      const cacheHit = matchedKey === options.key
      await reporter.output('cache-hit', String(cacheHit))
      return { cacheHit }
    } catch (error) {
      reporter.warning(`SEA download cache restore failed: ${String(error)}`)
      await reporter.output('cache-hit', 'false')
      return { cacheHit: false }
    }
  }
  if (
    cacheAccess === 'none' ||
    cacheAccess === 'read' ||
    cacheAccess === 'read-only'
  ) {
    reporter.warning('SEA download cache save skipped in read-only mode')
    return { cacheHit: false }
  }
  try {
    await cache.saveCache(paths, options.key)
  } catch (error) {
    reporter.warning(`SEA download cache save failed: ${String(error)}`)
  }
  return { cacheHit: false }
}

export function actionInput(name: string): string {
  return process.env[`INPUT_${name.toUpperCase()}`] ?? ''
}

export async function writeOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env['GITHUB_OUTPUT']
  if (!outputPath) {
    return
  }
  await appendFile(outputPath, `${name}=${value}\n`)
}

export async function main(): Promise<void> {
  const mode = actionInput('mode') as CacheMode
  const key = actionInput('key')
  const pathInput = resolveBlobPath(actionInput('path'))
  const restoreKeys = actionInput('restore-keys')
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
  await runCacheAction(
    { mode, key, path: pathInput, restoreKeys },
    { restoreCache, saveCache },
    {
      warning: message => process.stderr.write(`::warning::${message}\n`),
      output: writeOutput,
    },
  )
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main()
}
