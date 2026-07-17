#!/usr/bin/env node
/*
 * @file Build the V8 STARTUP-SNAPSHOT variant of the fleet hook dispatch
 *   bundle. SPIKE (spike/snapshot-hooks): proves a snapshot-booted dispatcher
 *   runs an event end-to-end at near-zero startup cost. Three steps:
 *
 *     1. Regenerate the static dispatch table (shared with the normal build).
 *     2. Rolldown the SNAPSHOT entry (`dispatch-snapshot-entry.mts`, which
 *        registers a V8 deserialize-main fn) to `_dispatch/snapshot-bundle.cjs`,
 *        with the logger stubbed (the logger graph is snapshot-hostile — it
 *        captures `SharedArrayBuffer` + touches `node:console`/`node:tty` at
 *        module-eval, and the dispatch path never reaches it).
 *     3. `node --snapshot-blob <out> --build-snapshot snapshot-bundle.cjs`,
 *        writing the blob into the ephemeral snapshot cache.
 *
 *   The blob path comes from the SHARED `snapshot-cache-path.cjs` — the same key
 *   derivation the loader uses — so it lands in `os.tmpdir()/node-snapshot-cache/
 *   <node-ver × arch × V8tag × uid>/<entry>-<content-hash>.blob`. The runtime tag
 *   means a node/arch/V8 change writes a fresh dir (never a refuse-to-boot blob in
 *   the active path); the content hash means a bundle edit writes a fresh blob
 *   (the loader misses → fails open to index.cjs).
 *
 *   Usage: `node scripts/fleet/build-hook-snapshot.mts`
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  DISPATCH_DIR,
  DISPATCH_TABLE_PATH,
  FLEET_HOOKS_DIR,
  generateDispatchTableSource,
} from './make-hook-dispatch.mts'
import {
  DISPATCH_TABLE_EXCLUDED_PATH,
  DISPATCH_TABLE_SNAPSHOT_PATH,
  EXCLUDED_BUNDLE_PATH,
  REPO_ROOT,
} from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const ROLLDOWN_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'rolldown')
const SNAPSHOT_CONFIG = path.join(
  REPO_ROOT,
  '.config',
  'repo',
  'rolldown',
  'hook-bundle-snapshot.config.mts',
)
const EXCLUDED_CONFIG = path.join(
  REPO_ROOT,
  '.config',
  'repo',
  'rolldown',
  'hook-bundle-excluded.config.mts',
)
const SNAPSHOT_BUNDLE = path.join(DISPATCH_DIR, 'snapshot-bundle.cjs')

// snapshot-cache-path.cjs is the SHARED key derivation: the loader resolves the
// exact same path at runtime, so the generator and the loader can never disagree
// on where a blob lives or how it's keyed. One source of truth, by construction.
const require = createRequire(import.meta.url)
const { blobPath } = require(
  path.join(DISPATCH_DIR, 'snapshot-cache-path.cjs'),
) as { blobPath: (entryId: string, sourceHash: string) => string }

/**
 * Content-key a built bundle — sha256, first 16 hex — the same derivation the
 * loader uses, so a bundle change always resolves to a fresh blob path.
 */
export function computeSourceHash(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Classify a spawned build step from its exit status + whether the expected
 * output landed.
 */
export function classifySpawnOutcome(
  exitStatus: number | null,
  outputExists: boolean,
): { ok: boolean } {
  return { ok: exitStatus === 0 && outputExists }
}

function main(): void {
  // All three table variants: the FULL table (index.cjs path), the
  // snapshot-SAFE table (aliased into the snapshot bundle), and the
  // EXCLUDED table (the sibling runtime bundle's source).
  writeFileSync(
    DISPATCH_TABLE_PATH,
    generateDispatchTableSource(FLEET_HOOKS_DIR),
  )
  writeFileSync(
    DISPATCH_TABLE_SNAPSHOT_PATH,
    generateDispatchTableSource(FLEET_HOOKS_DIR, 'snapshot'),
  )
  writeFileSync(
    DISPATCH_TABLE_EXCLUDED_PATH,
    generateDispatchTableSource(FLEET_HOOKS_DIR, 'excluded'),
  )

  mkdirSync(DISPATCH_DIR, { recursive: true })

  if (!existsSync(ROLLDOWN_BIN)) {
    logger.error(
      `rolldown not found at ${path.relative(REPO_ROOT, ROLLDOWN_BIN)}; run pnpm install.`,
    )
    process.exitCode = 2
    return
  }

  // The excluded-hooks sibling first: deserialize-main requires it at
  // runtime, so it must exist alongside every snapshot blob.
  const excluded = spawnSync(ROLLDOWN_BIN, ['-c', EXCLUDED_CONFIG], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (
    !classifySpawnOutcome(excluded.status, existsSync(EXCLUDED_BUNDLE_PATH)).ok
  ) {
    logger.error(
      `excluded bundle build failed (exit ${String(excluded.status)}).`,
    )
    process.exitCode = excluded.status ?? 1
    return
  }

  const bundle = spawnSync(ROLLDOWN_BIN, ['-c', SNAPSHOT_CONFIG], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (!classifySpawnOutcome(bundle.status, existsSync(SNAPSHOT_BUNDLE)).ok) {
    logger.error(
      `snapshot bundle build failed (exit ${String(bundle.status)}).`,
    )
    process.exitCode = bundle.status ?? 1
    return
  }

  // Content-key on the built bundle — the loader hashes snapshot-bundle.cjs the
  // same way (sha256, first 16 hex), so the blob written here is exactly the one
  // the loader looks for. A bundle change → new hash → new blob; the stale one is
  // orphaned in tmpdir and reaped, never booted.
  const sourceHash = computeSourceHash(readFileSync(SNAPSHOT_BUNDLE))
  const blobOut = blobPath('dispatch', sourceHash)
  mkdirSync(path.dirname(blobOut), { recursive: true })

  const snap = spawnSync(
    process.execPath,
    ['--snapshot-blob', blobOut, '--build-snapshot', SNAPSHOT_BUNDLE],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (!classifySpawnOutcome(snap.status, existsSync(blobOut)).ok) {
    logger.error(`--build-snapshot failed (exit ${String(snap.status)}).`)
    process.exitCode = snap.status ?? 1
    return
  }
  logger.log(`Built ${blobOut}.`)
}

if (isMainModule(import.meta.url)) {
  main()
}
