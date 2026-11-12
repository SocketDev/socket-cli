#!/usr/bin/env node
/**
 * @file Move a pinned tool's native snapshots from its old version to the
 *   pinned one by editing the version text, for automation that bumps the pin
 *   but cannot build the native CLI.
 *
 *   Usage:
 *     node scripts/test/swap-snapshot-version.mts --dep coana --from 15.15.0
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import {
  SNAPSHOT_DEPENDENCIES,
  findStaleSnapshotDependencies,
  normalizeSnapshotDependencyName,
  readPinnedVersion,
  snapshotDependencyUpdateHint,
} from './snapshot-dependencies.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { SnapshotDependency } from './snapshot-dependencies.mts'
import type { ScriptMeta } from '../lib/run-main.mts'

const ROOT = path.resolve(import.meta.dirname, '../..')

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace `from` with `to` in a terminal snapshot, taking or giving the
 * difference from the spaces that pad the row, so every row keeps its column
 * count and the rendered pixels match a real capture.
 */
export function swapVersionInSnapshot(
  contents: string,
  from: string,
  to: string,
): string {
  const pattern = new RegExp(
    `(?<![\\w.])${escapeRegExp(from)}(?!\\w|\\.\\d)(\\S*)( *)`,
    'g',
  )
  let found = false
  const swapped = contents.replace(
    pattern,
    (_match, tail: string, padding: string) => {
      found = true
      const width = from.length + padding.length
      if (to.length > width) {
        throw new Error(`No room in the row to replace ${from} with ${to}`)
      }
      return `${to}${tail}${' '.repeat(width - to.length)}`
    },
  )
  if (!found) {
    throw new Error(`The snapshot does not mention ${from}`)
  }
  return swapped
}

export async function main(): Promise<void> {
  const { dependencyName, from } = parseSwapArgs(process.argv.slice(2))
  const name = normalizeSnapshotDependencyName(dependencyName)
  if (!name) {
    throw new Error(`Unknown snapshot dependency: ${dependencyName}`)
  }
  const dependency: SnapshotDependency = SNAPSHOT_DEPENDENCIES[name]
  const to = await readPinnedVersion(dependency)
  const snapshots = dependency.versionSnapshots ?? dependency.snapshots
  // Swap every file in memory first, so a failure leaves none of them edited.
  const swapped = await Promise.all(
    snapshots.map(async snapshot => {
      const file = path.join(ROOT, snapshot)
      try {
        const contents = await fs.readFile(file, 'utf8')
        return { file, contents: swapVersionInSnapshot(contents, from, to) }
      } catch (e) {
        throw new Error(`${snapshot}: ${(e as Error).message}`)
      }
    }),
  )
  await Promise.all(
    swapped.map(({ contents, file }) => fs.writeFile(file, contents)),
  )
  const stale = (await findStaleSnapshotDependencies()).filter(
    finding => normalizeSnapshotDependencyName(finding.dependencyName) === name,
  )
  if (stale.length) {
    throw new Error(snapshotDependencyUpdateHint(stale))
  }
  process.stdout.write(
    `Moved ${snapshots.length} ${dependency.packageName} snapshots from ${from} to ${to}\n`,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "moves a pinned tool's native snapshots to its pinned version without a native build",
  help: `Usage: node scripts/test/swap-snapshot-version.mts --dep <name> --from <old version>

  --dep   coana, socket-patch or patch
  --from  the version the snapshots show now

  Run it after bumping the pin. It fails without editing anything when a
  snapshot does not show the old version or a row has no room for the new one.
  Fall back to pnpm snapshots:update:dep <name> in that case.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
