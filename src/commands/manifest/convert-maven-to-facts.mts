import { runManifestFacts } from './run-manifest-facts.mts'

import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `.socket.facts.json` for a Maven project via the bundled extension.
export async function convertMavenToFacts({
  bin,
  cwd,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  mavenOpts,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  mavenOpts: string[]
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<void> {
  await runManifestFacts({
    bin,
    buildOpts: mavenOpts,
    cwd,
    ecosystem: 'maven',
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    sidecarAcc,
    verbose,
    withFiles,
  })
}
