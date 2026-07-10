import { runManifestFacts } from './run-manifest-facts.mts'

import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `.socket.facts.json` for a Gradle project via the bundled init script.
export async function convertGradleToFacts({
  bin,
  cwd,
  excludeConfigs,
  excludePaths,
  gradleOpts,
  ignoreUnresolved,
  includeConfigs,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  excludePaths?: string[] | undefined
  gradleOpts: string[]
  ignoreUnresolved: boolean
  includeConfigs: string
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<void> {
  await runManifestFacts({
    bin,
    buildOpts: gradleOpts,
    cwd,
    ecosystem: 'gradle',
    excludeConfigs,
    excludePaths,
    ignoreUnresolved,
    includeConfigs,
    sidecarAcc,
    verbose,
    withFiles,
  })
}
