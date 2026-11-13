import { runManifestFacts } from './run-manifest-facts.mts'

import type {
  BuildOptionHints,
  RunManifestFactsOutcome,
  SocketFactsContext,
} from './run-manifest-facts.mts'

// Generates `sbt.socket.facts.json` for an sbt project with Coana.
// sbt 0.13/early 1.x can't run on modern JDKs — pass a compatible JDK via
// `--sbt-opts "--java-home <path>"` or `JAVA_HOME`.
export async function convertSbtToFacts({
  bin,
  context,
  cwd,
  excludeConfigs,
  excludePaths,
  hints,
  ignoreUnresolved,
  includeConfigs,
  javaHome,
  sbtOpts,
  verbose,
}: {
  bin: string
  context?: SocketFactsContext | undefined
  cwd: string
  excludeConfigs: string
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  ignoreUnresolved: boolean
  includeConfigs: string
  javaHome?: string | undefined
  sbtOpts: string[]
  verbose: boolean
}): Promise<RunManifestFactsOutcome> {
  return await runManifestFacts({
    bin,
    buildOpts: sbtOpts,
    context,
    cwd,
    ecosystem: 'sbt',
    excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved,
    includeConfigs,
    javaHome,
    verbose,
  })
}
