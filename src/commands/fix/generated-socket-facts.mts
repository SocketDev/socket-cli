import { copyFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { runDynamicSbomInference } from '../scan/run-dynamic-sbom-inference.mts'

export type GeneratedSocketFacts = {
  paths: string[]
  remove: () => Promise<void>
  restore: () => Promise<void>
}

// The generated files describe the build before any fix, so they are kept
// aside for restoring after `git clean` and removed once the fix is done.
export async function generateSocketFactsForFix({
  cwd,
  excludePaths,
  tmpDir,
}: {
  cwd: string
  excludePaths: string[]
  tmpDir: string
}): Promise<GeneratedSocketFacts> {
  const { factsPaths } = await runDynamicSbomInference({
    cwd,
    excludePaths,
    sbtTmpDir: undefined,
    withFiles: false,
  })
  const paths = factsPaths.map(p => path.resolve(cwd, p))
  const backups = await Promise.all(
    paths.map(async (source, index) => {
      const backup = path.join(tmpDir, `${index}.json`)
      await copyFile(source, backup)
      return { backup, source }
    }),
  )
  return {
    paths,
    async remove() {
      await Promise.all(paths.map(p => rm(p, { force: true })))
    },
    async restore() {
      await Promise.all(
        backups.map(({ backup, source }) => copyFile(backup, source)),
      )
    },
  }
}
