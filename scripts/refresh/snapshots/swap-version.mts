#!/usr/bin/env node
/**
 * @file Move a pinned tool's native snapshots from its old version to the
 *   pinned one by editing the version text, for automation that bumps the pin
 *   but cannot build the native CLI.
 *
 *   Usage:
 *     node scripts/refresh/snapshots/swap-version.mts --dep coana --from 15.15.0
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { isMainModule } from '../../lib/is-main-module.mts'
import type { ScriptMeta } from '../../lib/run-main.mts'
import { runMain } from '../../lib/run-main.mts'

import type { SnapshotDependency } from './dependencies.mts'
import {
  findStaleSnapshotDependencies,
  normalizeSnapshotDependencyName,
  readPinnedVersion,
  SNAPSHOT_DEPENDENCIES as snapshotDependencies,
  snapshotDependencyUpdateHint,
  swapVersionInSnapshot,
} from './dependencies.mts'

const ROOT = path.resolve(import.meta.dirname, '../../..')

export interface SwapArgs {
  readonly dependencyName: string
  readonly from: string
}

export function parseSwapArgs(argv: readonly string[]): SwapArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: { dep: { type: 'string' }, from: { type: 'string' } },
    strict: true,
  })
  if (!values.dep || !values.from) {
    throw new Error('Pass both --dep <name> and --from <old version>')
  }
  return { dependencyName: values.dep, from: values.from }
}

export async function main(): Promise<void> {
  const { dependencyName, from } = parseSwapArgs(process.argv.slice(2))
  const name = normalizeSnapshotDependencyName(dependencyName)
  if (!name) {
    throw new Error(`Unknown snapshot dependency: ${dependencyName}`)
  }
  const dependency: SnapshotDependency = snapshotDependencies[name]
  const to = await readPinnedVersion(dependency)
  const snapshots = dependency.versionSnapshots ?? dependency.snapshots
  // Swap every file in memory first, so a failure leaves none of them edited.
  const swapped = await Promise.all(
    snapshots.map(async snapshot => {
      const file = path.join(ROOT, snapshot)
      try {
        const original = await fs.readFile(file, 'utf8')
        return {
          file,
          original,
          contents: swapVersionInSnapshot(original, from, to),
        }
      } catch (e) {
        throw new Error(`${snapshot}: ${(e as Error).message}`)
      }
    }),
  )
  const pendingWrites = swapped.filter(
    ({ contents, original }) => contents !== original,
  )
  await Promise.all(
    pendingWrites.map(({ contents, file }) => fs.writeFile(file, contents)),
  )
  const stale = (await findStaleSnapshotDependencies()).filter(
    finding => normalizeSnapshotDependencyName(finding.dependencyName) === name,
  )
  if (stale.length) {
    throw new Error(snapshotDependencyUpdateHint(stale))
  }
  process.stdout.write(
    `Updated ${pendingWrites.length} ${dependency.packageName} snapshots from ${from} to ${to}\n`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "moves a pinned tool's native snapshots to its pinned version without a native build",
  help: `Usage: node scripts/refresh/snapshots/swap-version.mts --dep <name> --from <old version>

  --dep   coana, socket-patch or patch
  --from  the version the snapshots show now

  Run it after bumping the pin. It fails without editing anything when a
  snapshot does not show the old version or a row has no room for the new one.
  Fall back to pnpm snapshots:update:dep <name> in that case.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
