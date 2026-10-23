import { runManifestFacts } from './run-manifest-facts.mts'

import type { RunManifestFactsOutcome } from './run-manifest-facts.mts'
import type { BuildOptionHints } from './scripts/resolution-report-render.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `gradle.socket.facts.json` for a Gradle project via the bundled
// init script.
export async function convertGradleToFacts({
  bin,
  cwd,
  excludeConfigs,
  excludePaths,
  gradleOpts,
  hints,
  ignoreUnresolved,
  includeConfigs,
  javaHome,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  excludePaths?: string[] | undefined
  gradleOpts: string[]
  hints?: BuildOptionHints | undefined
  ignoreUnresolved: boolean
  includeConfigs: string
  javaHome?: string | undefined
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<RunManifestFactsOutcome> {
  return await runManifestFacts({
    bin,
    buildOpts: gradleOpts,
    cwd,
    ecosystem: 'gradle',
    excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved,
    includeConfigs,
    javaHome,
    sidecarAcc,
    verbose,
    withFiles,
  })
}
