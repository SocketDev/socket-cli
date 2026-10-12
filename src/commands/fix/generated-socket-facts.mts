import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runDynamicSbomInference } from '../scan/run-dynamic-sbom-inference.mts'

export type GeneratedSocketFacts = {
  paths: string[]
  // The facts files' per-project classpaths, outside the repository.
  sidecarFile: string | undefined
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
  cwd,
  excludePaths,
  findFactsPaths,
  tmpDir,
}: {
  cwd: string
  excludePaths: string[]
  findFactsPaths: () => Promise<string[]>
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
  let paths: string[]
  let sidecarFile: string | undefined
  try {
    const { factsPaths, resolvedPathsSidecar } = await runDynamicSbomInference({
      cwd,
      excludePaths,
      sbtTmpDir: undefined,
      sidecar: true,
      withFiles: false,
    })
    paths = factsPaths.map(p => path.resolve(cwd, p))
    if (resolvedPathsSidecar) {
      sidecarFile = path.join(tmpDir, 'sidecar.json')
      await writeFile(sidecarFile, JSON.stringify(resolvedPathsSidecar))
    }
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
    paths,
    sidecarFile,
    remove: () => reset(paths),
    restore: () => restoreAll(backups),
  }
}
