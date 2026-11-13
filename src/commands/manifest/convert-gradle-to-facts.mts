import { runManifestFacts } from './run-manifest-facts.mts'

import type {
  BuildOptionHints,
  RunManifestFactsOutcome,
  SocketFactsContext,
} from './run-manifest-facts.mts'

// Generates `gradle.socket.facts.json` for a Gradle project with Coana.
export async function convertGradleToFacts({
  bin,
  context,
  cwd,
  excludeConfigs,
  excludePaths,
  gradleOpts,
  hints,
  ignoreUnresolved,
  includeConfigs,
  javaHome,
  verbose,
}: {
  bin: string
  context?: SocketFactsContext | undefined
  cwd: string
  excludeConfigs: string
  excludePaths?: string[] | undefined
  gradleOpts: string[]
  hints?: BuildOptionHints | undefined
  ignoreUnresolved: boolean
  includeConfigs: string
  javaHome?: string | undefined
  verbose: boolean
}): Promise<RunManifestFactsOutcome> {
  return await runManifestFacts({
    bin,
    buildOpts: gradleOpts,
    context,
    cwd,
    ecosystem: 'gradle',
    excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved,
    includeConfigs,
    javaHome,
    verbose,
  })
}
