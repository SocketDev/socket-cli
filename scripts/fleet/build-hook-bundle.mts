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
  DISPATCH_MANIFEST_PATH,
  DISPATCH_TABLE_PATH,
  FLEET_HOOKS_DIR,
  generateDispatchManifestSource,
  generateDispatchTableSource,
  HOOK_BUNDLE_PATH,
} from './make-hook-dispatch.mts'
import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

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

export interface BundleBuildOutcome {
  failureReason?: 'missing-output' | 'spawn-failed' | undefined
  ok: boolean
}

/**
 * Whether a fresh dispatch-table regen differs from what's on disk.
 */
export function isDispatchTableStale(
  generated: string,
  onDisk: string,
): boolean {
  return onDisk !== generated
}

/**
 * Classify a rolldown build attempt from its exit status + whether the
 * expected output landed.
 */
export function classifyBundleBuild(
  exitStatus: number | null,
  outputExists: boolean,
): BundleBuildOutcome {
  if (exitStatus !== 0) {
    return { failureReason: 'spawn-failed', ok: false }
  }
  if (!outputExists) {
    return { failureReason: 'missing-output', ok: false }
  }
  return { ok: true }
}

function main(): void {
  const checkOnly = process.argv.includes('--check')
  const generated = generateDispatchTableSource(FLEET_HOOKS_DIR)
  const generatedManifest = generateDispatchManifestSource(FLEET_HOOKS_DIR)
  if (checkOnly) {
    const onDisk = existsSync(DISPATCH_TABLE_PATH)
      ? readFileSync(DISPATCH_TABLE_PATH, 'utf8')
      : ''
    if (isDispatchTableStale(generated, onDisk)) {
      logger.error(
        `dispatch-table.mts is stale. Rebuild:\n` +
          `  node scripts/fleet/build-hook-bundle.mts`,
      )
      process.exitCode = 2
      return
    }
    const manifestOnDisk = existsSync(DISPATCH_MANIFEST_PATH)
      ? readFileSync(DISPATCH_MANIFEST_PATH, 'utf8')
      : ''
    if (isDispatchTableStale(generatedManifest, manifestOnDisk)) {
      logger.error(
        `dispatch-manifest.json is stale. Rebuild:\n` +
          `  node scripts/fleet/build-hook-bundle.mts`,
      )
      process.exitCode = 2
      return
    }
    logger.log('dispatch-table.mts + dispatch-manifest.json are current.')
    return
  }
  writeFileSync(DISPATCH_TABLE_PATH, generated)
  // The dep-0 bootstrap dispatcher routes off the manifest; regenerate it in
  // lock-step with the table so the two never drift (this is the dogfood path —
  // build-hook-bundle writes the table directly, not via make-hook-dispatch).
  writeFileSync(DISPATCH_MANIFEST_PATH, generatedManifest)

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
  const outcome = classifyBundleBuild(
    result.status,
    existsSync(HOOK_BUNDLE_PATH),
  )
  if (!outcome.ok) {
    if (outcome.failureReason === 'spawn-failed') {
      logger.error(`rolldown build failed (exit ${String(result.status)}).`)
      process.exitCode = result.status ?? 1
    } else {
      logger.error(`rolldown finished but ${HOOK_BUNDLE_PATH} is missing.`)
      process.exitCode = 1
    }
    return
  }
  logger.log(`Built ${path.relative(REPO_ROOT, HOOK_BUNDLE_PATH)}.`)
}

if (isMainModule(import.meta.url)) {
  main()
}
