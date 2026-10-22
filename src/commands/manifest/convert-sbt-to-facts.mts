import { runManifestFacts } from './run-manifest-facts.mts'

import type { BuildOptionHints } from './scripts/resolution-report-render.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `sbt.socket.facts.json` for an sbt project via the bundled sbt plugin.
// sbt 0.13/early 1.x can't run on modern JDKs — pass a compatible JDK via
// `--sbt-opts "--java-home <path>"` or `JAVA_HOME`.
export async function convertSbtToFacts({
  bin,
  cwd,
  excludeConfigs,
  excludePaths,
  hints,
  ignoreUnresolved,
  includeConfigs,
  javaHome,
  sbtOpts,
  sidecarAcc,
  tmpDir,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  ignoreUnresolved: boolean
  includeConfigs: string
  javaHome?: string | undefined
  sbtOpts: string[]
  sidecarAcc?: SidecarAccumulator | undefined
  // Caller-owned; see ManifestScriptOptions.tmpDir.
  tmpDir: string
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<void> {
  await runManifestFacts({
    bin,
    buildOpts: sbtOpts,
    cwd,
    ecosystem: 'sbt',
    excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved,
    includeConfigs,
    javaHome,
    sidecarAcc,
    tmpDir,
    verbose,
    withFiles,
  })
}
