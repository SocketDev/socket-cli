import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  EXCLUDE_PATHS_HINTS,
  createSocketFactsWorkDir,
  socketFactsSidecar,
} from '../manifest/run-manifest-facts.mts'
import { runDynamicSbomInference } from '../scan/run-dynamic-sbom-inference.mts'

import type { FactsOnlyTypes } from '../../utils/coana.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { SocketFactsContext } from '../manifest/run-manifest-facts.mts'

export type GeneratedSocketFacts = {
  // Facts files of dropped runs, which Coana must not read.
  discardedPaths: string[]
  // The purl types whose artifacts Coana takes from the facts files alone.
  factsOnlyTypes: FactsOnlyTypes
  paths: string[]
  // Records each build root's saved state for `--socket-facts-sidecar`.
  // The file lives outside the repository.
  sidecarFile: string
  remove: () => Promise<void>
  restore: () => Promise<void>
}

type Backup = { backup: string; source: string }

async function backUp(sources: string[], dir: string): Promise<Backup[]> {
  await mkdir(dir, { recursive: true })
  return await Promise.all(
    sources.map(async (source, index) => {
      const backup = path.join(dir, `${index}.json`)
      await copyFile(source, backup)
      return { backup, source }
    }),
  )
}

async function restoreAll(backups: Backup[]): Promise<void> {
  await Promise.all(
    backups.map(({ backup, source }) => copyFile(backup, source)),
  )
}

// Backed up so each fix attempt sees the pre-fix build after `git clean`, and
// facts files already present are left as they were found.
export async function generateSocketFactsForFix({
  context,
  cwd,
  excludePaths,
  findFactsPaths,
  purlTypes,
  tmpDir,
}: {
  context: Omit<SocketFactsContext, 'workDir'>
  cwd: string
  excludePaths: string[]
  findFactsPaths: () => Promise<string[]>
  purlTypes: readonly PURL_Type[]
  tmpDir: string
}): Promise<GeneratedSocketFacts> {
  const existingPaths = await findFactsPaths()
  const originals = await backUp(existingPaths, path.join(tmpDir, 'existing'))
  const existing = new Set(existingPaths)
  const reset = async (written: string[]) => {
    await Promise.all(
      written.filter(p => !existing.has(p)).map(p => rm(p, { force: true })),
    )
    await restoreAll(originals)
  }
  let discardedPaths: string[]
  let factsOnlyTypes: FactsOnlyTypes
  let paths: string[]
  const sidecarFile = path.join(tmpDir, 'sidecar.json')
  const workDir = await createSocketFactsWorkDir(
    path.join(tmpDir, 'work'),
    'fix',
  )
  try {
    const inferred = await runDynamicSbomInference({
      context: { ...context, workDir },
      cwd,
      excludePaths,
      hints: EXCLUDE_PATHS_HINTS,
      purlTypes,
    })
    discardedPaths = inferred.discardedFactsPaths
    factsOnlyTypes = inferred.factsOnlyTypes
    paths = inferred.factsPaths.map(p => path.resolve(cwd, p))
    // Written even when empty, as for reach; applying fixes looks each facts
    // file up in it, so an empty one is the same as none.
    await writeFile(sidecarFile, JSON.stringify(socketFactsSidecar(workDir)))
  } catch (e) {
    // A failed build root aborts inference after others wrote their facts.
    await reset(await findFactsPaths())
    throw e
  }
  const generated = new Set(paths)
  const backups = [
    ...originals.filter(({ source }) => !generated.has(source)),
    ...(await backUp(paths, path.join(tmpDir, 'generated'))),
  ]
  return {
    discardedPaths,
    factsOnlyTypes,
    paths,
    sidecarFile,
    remove: () => reset(paths),
    restore: () => restoreAll(backups),
  }
}
