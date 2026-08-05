#!/usr/bin/env node
/*
 * @file Build the V8 STARTUP-SNAPSHOT variant of the fleet hook dispatch
 *   bundle. SPIKE (spike/snapshot-hooks): proves a snapshot-booted dispatcher
 *   runs an event end-to-end at near-zero startup cost. Three steps:
 *
 *     1. Regenerate the static dispatch table, shared with the normal build.
 *     2. Rolldown the SNAPSHOT entry (`dispatch-snapshot-entry.mts`, which
 *        registers a V8 deserialize-main fn) to `_shared/snapshot-fleet-pack.cjs`,
 *        with the logger stubbed (the logger graph is snapshot-hostile — it
 *        captures `SharedArrayBuffer` + touches `node:console`/`node:tty` at
 *        module-eval, and the dispatch path never reaches it).
 *     3. `node --snapshot-blob <out> --build-snapshot snapshot-fleet-pack.cjs`,
 *        writing the blob into the ephemeral snapshot cache.
 *
 *   The blob path comes from the SHARED `snapshot-cache-path.cjs` — the same key
 *   derivation the loader uses — so it lands in `.cache/fleet/
 *   node-snapshot-cache/<node-ver × arch × V8tag × uid>/<entry>-<content-hash>.blob`.
 *   The runtime tag means a node/arch/V8 change writes a fresh dir (never a
 *   refuse-to-boot blob in the active path); the content hash means a bundle edit
 *   writes a fresh blob (the loader misses → fails open to index.cjs). That cache
 *   is NOT OS-reaped, so after a successful build `pruneStaleBlobs` deletes the
 *   prior content-hashed blobs keep-active-only.
 *
 *   Usage: `node scripts/fleet/build-hook-snapshot.mts`
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  DISPATCH_DIR,
  DISPATCH_TABLE_PATH,
  FLEET_HOOKS_DIR,
  generateDispatchTableSource,
} from './gen/hook-dispatch.mts'
import { writeHookValidators } from './gen/hook-validators.mts'
import {
  DISPATCH_TABLE_EXCLUDED_PATH,
  DISPATCH_TABLE_SNAPSHOT_PATH,
  EXCLUDED_BUNDLE_PATH,
  REPO_ROOT,
} from './paths.mts'
import { hasFleetHookSource } from './_shared/fleet-source-present.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import {
  liftMirrorLockSync,
  writeThroughMirrorLock,
} from './_shared/mirror-lock.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const ROLLDOWN_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'rolldown')
const SNAPSHOT_CONFIG = path.join(
  REPO_ROOT,
  '.config',
  'fleet',
  'rolldown',
  'hook-bundle-snapshot.config.mts',
)
const EXCLUDED_CONFIG = path.join(
  REPO_ROOT,
  '.config',
  'fleet',
  'rolldown',
  'hook-bundle-excluded.config.mts',
)
const SNAPSHOT_BUNDLE = path.join(DISPATCH_DIR, 'snapshot-fleet-pack.cjs')

// snapshot-cache-path.cjs is the SHARED key derivation: the loader resolves the
// exact same path at runtime, so the generator and the loader can never disagree
// on where a blob lives or how it's keyed. One source of truth, by construction.
const require = createRequire(import.meta.url)
const { blobPath, pruneStaleBlobs } = require(
  path.join(DISPATCH_DIR, 'snapshot-cache-path.cjs'),
) as {
  blobPath: (entryId: string, sourceHash: string) => string
  pruneStaleBlobs: (keepBlobPath: string) => void
}

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
export function classifySpawnOutcome(config: {
  exitStatus: number | null
  outputExists: boolean
}): { ok: boolean } {
  const cfg = { __proto__: null, ...config }
  const { exitStatus, outputExists } = cfg
  return { ok: exitStatus === 0 && outputExists }
}

function main(): void {
  // A bundle-only member has no hook source — regenerating the table variants
  // + snapshot bundles over absent dirs would emit empty artifacts. Built at
  // the source repo; the per-machine snapshot re-primes only where source ships.
  if (!hasFleetHookSource(REPO_ROOT)) {
    logger.log(
      '[build-hook-snapshot] no fleet hook source (bundle-only) — skipping the snapshot build.',
    )
    return
  }
  // All three table variants: the FULL table (index.cjs path), the
  // snapshot-SAFE table, aliased into the snapshot bundle, and the
  // EXCLUDED table, the sibling runtime bundle's source. The outputs live
  // inside the cascade-locked hook mirror; lift the read-only lock around
  // each regeneration write.
  writeThroughMirrorLock(
    DISPATCH_TABLE_PATH,
    generateDispatchTableSource(FLEET_HOOKS_DIR),
  )
  writeThroughMirrorLock(
    DISPATCH_TABLE_SNAPSHOT_PATH,
    generateDispatchTableSource(FLEET_HOOKS_DIR, 'snapshot'),
  )
  writeThroughMirrorLock(
    DISPATCH_TABLE_EXCLUDED_PATH,
    generateDispatchTableSource(FLEET_HOOKS_DIR, 'excluded'),
  )
  // The ahead-of-time TypeBox validators refresh alongside the tables, so the
  // snapshot freezes a hook graph that no longer carries the TypeBox compiler.
  writeHookValidators()

  mkdirSync(DISPATCH_DIR, { recursive: true })

  if (!existsSync(ROLLDOWN_BIN)) {
    logger.error(
      `rolldown not found at ${path.relative(REPO_ROOT, ROLLDOWN_BIN)}; run pnpm install.`,
    )
    process.exitCode = 2
    return
  }

  // The excluded-hooks sibling first: deserialize-main requires it at
  // runtime, so it must exist alongside every snapshot blob. Its output
  // lives inside the cascade-locked hook mirror; lift the read-only lock
  // before rolldown writes it.
  liftMirrorLockSync(EXCLUDED_BUNDLE_PATH)
  const excluded = spawnSync(ROLLDOWN_BIN, ['-c', EXCLUDED_CONFIG], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (
    !classifySpawnOutcome({
      exitStatus: excluded.status,
      outputExists: existsSync(EXCLUDED_BUNDLE_PATH),
    }).ok
  ) {
    logger.error(
      `excluded bundle build failed (exit ${String(excluded.status)}).`,
    )
    process.exitCode = excluded.status ?? 1
    return
  }

  // Same lock-lift as above: SNAPSHOT_BUNDLE lives inside the cascade-locked
  // hook mirror.
  liftMirrorLockSync(SNAPSHOT_BUNDLE)
  const bundle = spawnSync(ROLLDOWN_BIN, ['-c', SNAPSHOT_CONFIG], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  if (
    !classifySpawnOutcome({
      exitStatus: bundle.status,
      outputExists: existsSync(SNAPSHOT_BUNDLE),
    }).ok
  ) {
    logger.error(
      `snapshot bundle build failed (exit ${String(bundle.status)}).`,
    )
    process.exitCode = bundle.status ?? 1
    return
  }

  // Content-key on the built bundle — the loader hashes snapshot-fleet-pack.cjs the
  // same way (sha256, first 16 hex), so the blob written here is exactly the one
  // the loader looks for. A bundle change → new hash → new blob; the stale one is
  // an orphan that .cache never OS-reaps, so it is pruned below.
  const sourceHash = computeSourceHash(readFileSync(SNAPSHOT_BUNDLE))
  const blobOut = blobPath('dispatch', sourceHash)
  mkdirSync(path.dirname(blobOut), { recursive: true })

  const snap = spawnSync(
    process.execPath,
    ['--snapshot-blob', blobOut, '--build-snapshot', SNAPSHOT_BUNDLE],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (
    !classifySpawnOutcome({
      exitStatus: snap.status,
      outputExists: existsSync(blobOut),
    }).ok
  ) {
    logger.error(`--build-snapshot failed (exit ${String(snap.status)}).`)
    process.exitCode = snap.status ?? 1
    return
  }
  logger.log(`Built ${blobOut}.`)
  // Reclaim orphans from prior bundle edits — keep only the blob just built. The
  // launcher's snapshot-blob.path sidecar, frozen next by build-snapshot-launcher
  // will name exactly this one, so every other blob is a stale content hash.
  pruneStaleBlobs(blobOut)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'build the V8 startup-snapshot variant of the fleet hook dispatch bundle',
  help: 'Usage: node scripts/fleet/build-hook-snapshot.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
