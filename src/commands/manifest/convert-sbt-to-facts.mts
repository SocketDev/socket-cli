import { runManifestFacts } from './run-manifest-facts.mts'

import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `.socket.facts.json` for an sbt project via the bundled sbt plugin.
// sbt 0.13/early 1.x can't run on modern JDKs — pass a compatible JDK via
// `--sbt-opts "--java-home <path>"` or `JAVA_HOME`.
export async function convertSbtToFacts({
  bin,
  cwd,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  sbtOpts,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  sbtOpts: string[]
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<void> {
  await runManifestFacts({
    bin,
    buildOpts: sbtOpts,
    cwd,
    ecosystem: 'sbt',
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    sidecarAcc,
    verbose,
    withFiles,
  })
}
