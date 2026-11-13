import { runManifestFacts } from './run-manifest-facts.mts'

import type {
  BuildOptionHints,
  RunManifestFactsOutcome,
  SocketFactsContext,
} from './run-manifest-facts.mts'

// Generates `pom.xml.socket.facts.json` (named after the POM Maven runs on)
// for a Maven project with Coana.
export async function convertMavenToFacts({
  bin,
  context,
  cwd,
  excludeConfigs,
  excludePaths,
  hints,
  ignoreUnresolved,
  includeConfigs,
  javaHome,
  mavenOpts,
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
  mavenOpts: string[]
  verbose: boolean
}): Promise<RunManifestFactsOutcome> {
  return await runManifestFacts({
    bin,
    buildOpts: mavenOpts,
    context,
    cwd,
    ecosystem: 'maven',
    excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved,
    includeConfigs,
    javaHome,
    verbose,
  })
}
