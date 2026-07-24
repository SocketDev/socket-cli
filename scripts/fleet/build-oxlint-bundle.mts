#!/usr/bin/env node
/**
 * @file Build the fleet oxlint plugin bundle. Runs rolldown with
 *   `.config/fleet/rolldown/oxlint-plugin.config.mts` to inline the plugin
 *   entry + every `socket/*` rule into a single ESM
 *   `.config/fleet/oxlint-plugin.mjs`. Members load THIS artifact via
 *   `jsPlugins` instead of the ~100 rule source dirs; the wheelhouse edits +
 *   tests the source and builds the bundle from it. Unlike the hook bundle
 *   there is no dispatch table and no capability gating — the `socket/*` rule
 *   set is fleet-wide, so this is ONE artifact for every repo. Output is
 *   gitignored + shipped in the release bundle, never committed. Usage: `node
 *   scripts/fleet/build-oxlint-bundle.mts [--check]` --check exit 2 if the
 *   bundle is missing, or (source present) older than the newest plugin source
 *   file (stale); does not rebuild.
 */

// prefer-async-spawn: sync-required — top-level CLI build runner; the flow is a
// single sequential rolldown spawn followed by an output-existence assertion.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  OXLINT_PLUGIN_BUNDLE_PATH,
  OXLINT_PLUGIN_DIR,
  REPO_ROOT,
} from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

export const ROLLDOWN_CONFIG = path.join(
  REPO_ROOT,
  '.config',
  'fleet',
  'rolldown',
  'oxlint-plugin.config.mts',
)
export const ROLLDOWN_BIN = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  'rolldown',
)

/**
 * The newest mtime (ms) of any file under `dir`, or 0 when the dir is absent. A
 * bundle-only member has no plugin source, so nothing can be newer than the
 * bundle and `--check` treats an existing bundle as current.
 */
export function latestSourceMtime(dir: string): number {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let newest = 0
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const d = entries[i]!
    const full = path.join(dir, d.name)
    const m = d.isDirectory() ? latestSourceMtime(full) : statSync(full).mtimeMs
    if (m > newest) {
      newest = m
    }
  }
  return newest
}

/**
 * A bundle is stale when it's missing, or (source present) older than the
 * newest source file. Pure.
 */
export function isBundleStale(config: {
  bundleMtime: number | undefined
  sourceMtime: number
}): boolean {
  const cfg = { __proto__: null, ...config }
  if (cfg.bundleMtime === undefined) {
    return true
  }
  return cfg.sourceMtime > cfg.bundleMtime
}

function main(): void {
  const checkOnly = process.argv.includes('--check')
  if (checkOnly) {
    const bundleMtime = existsSync(OXLINT_PLUGIN_BUNDLE_PATH)
      ? statSync(OXLINT_PLUGIN_BUNDLE_PATH).mtimeMs
      : undefined
    const sourceMtime = latestSourceMtime(OXLINT_PLUGIN_DIR)
    if (isBundleStale({ bundleMtime, sourceMtime })) {
      logger.error(
        'oxlint-plugin.mjs is stale or missing. Rebuild:\n' +
          '  node scripts/fleet/build-oxlint-bundle.mts',
      )
      process.exitCode = 2
      return
    }
    logger.log('.config/fleet/oxlint-plugin.mjs is current.')
    return
  }
  if (!existsSync(ROLLDOWN_BIN)) {
    logger.error(
      `rolldown binary not found at ${path.relative(REPO_ROOT, ROLLDOWN_BIN)}.\n` +
        '  Run `pnpm install` from the repo root first.',
    )
    process.exitCode = 2
    return
  }
  const result = spawnSync(ROLLDOWN_BIN, ['-c', ROLLDOWN_CONFIG], {
    cwd: REPO_ROOT,
    // Windows: node_modules/.bin/rolldown has no extension, so a direct spawn
    // ENOENTs — a shell resolves it via PATHEXT. POSIX keeps the direct spawn.
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    logger.error(`rolldown build failed (exit ${String(result.status)}).`)
    process.exitCode = result.status ?? 1
    return
  }
  if (!existsSync(OXLINT_PLUGIN_BUNDLE_PATH)) {
    logger.error(
      `rolldown finished but ${OXLINT_PLUGIN_BUNDLE_PATH} is missing.`,
    )
    process.exitCode = 1
    return
  }
  logger.log(`Built ${path.relative(REPO_ROOT, OXLINT_PLUGIN_BUNDLE_PATH)}.`)
}

if (isMainModule(import.meta.url)) {
  main()
}
