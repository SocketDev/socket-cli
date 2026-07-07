#!/usr/bin/env node
/**
 * @file Build the fleet hook dispatch bundle. Regenerates the STATIC dispatch
 *   table (`make-hook-dispatch.mts`) so the bundle reflects the current
 *   bundle-safe hook set, then runs rolldown with
 *   `.config/fleet/rolldown/hook-bundle.config.mts` to emit the minified CJS
 *   `_dispatch/bundle.cjs`.
 *   The hand-written `_dispatch/index.cjs` loader (NOT bundled) turns on the V8
 *   compile cache, then `require()`s the bundle. Output is CJS so the compile
 *   cache reliably persists; see docs/agents.md/fleet/hook-bundle.md.
 *   Usage: `node scripts/fleet/build-hook-bundle.mts [--check]`
 *   --check  fail (exit 2) if the dispatch table is stale; does not rebuild.
 */

// prefer-async-spawn: sync-required — top-level CLI build runner; the flow is
// sequential (regenerate table, then bundle, then check the artifact).
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  DISPATCH_TABLE_PATH,
  FLEET_HOOKS_DIR,
  generateDispatchTableSource,
  HOOK_BUNDLE_PATH,
} from './make-hook-dispatch.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

export const ROLLDOWN_CONFIG = path.join(
  REPO_ROOT,
  '.config',
  'fleet',
  'rolldown',
  'hook-bundle.config.mts',
)
export const ROLLDOWN_BIN = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  'rolldown',
)

function main(): void {
  const checkOnly = process.argv.includes('--check')
  const generated = generateDispatchTableSource(FLEET_HOOKS_DIR)
  if (checkOnly) {
    const onDisk = existsSync(DISPATCH_TABLE_PATH)
      ? readFileSync(DISPATCH_TABLE_PATH, 'utf8')
      : ''
    if (onDisk !== generated) {
      logger.error(
        `dispatch-table.mts is stale. Rebuild:\n` +
          `  node scripts/fleet/build-hook-bundle.mts`,
      )
      process.exitCode = 2
      return
    }
    logger.log('dispatch-table.mts is current (no rebuild requested).')
    return
  }
  writeFileSync(DISPATCH_TABLE_PATH, generated)

  if (!existsSync(ROLLDOWN_BIN)) {
    logger.error(
      `rolldown binary not found at ${path.relative(REPO_ROOT, ROLLDOWN_BIN)}.\n` +
        `  Run \`pnpm install\` from the repo root first.`,
    )
    process.exitCode = 2
    return
  }
  const result = spawnSync(ROLLDOWN_BIN, ['-c', ROLLDOWN_CONFIG], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    logger.error(`rolldown build failed (exit ${String(result.status)}).`)
    process.exitCode = result.status ?? 1
    return
  }
  if (!existsSync(HOOK_BUNDLE_PATH)) {
    logger.error(`rolldown finished but ${HOOK_BUNDLE_PATH} is missing.`)
    process.exitCode = 1
    return
  }
  logger.log(`Built ${path.relative(REPO_ROOT, HOOK_BUNDLE_PATH)}.`)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
