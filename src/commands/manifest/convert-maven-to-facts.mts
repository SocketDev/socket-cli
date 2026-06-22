import { runCoanaManifestFacts } from './coana-manifest-facts.mts'

// Generates a `.socket.facts.json` for a Maven project by delegating to the
// Coana CLI's `manifest maven` command (which owns the Maven plugin that
// resolves the dependency graph). socket-cli no longer runs maven itself; an
// explicit `bin` is forwarded as `--bin`, otherwise Coana defaults to `mvn` on
// PATH.
export async function convertMavenToFacts({
  bin,
  cwd,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  mavenOpts,
  verbose,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  mavenOpts: string[]
  verbose: boolean
}): Promise<void> {
  await runCoanaManifestFacts({
    bin,
    buildOpts: mavenOpts,
    buildOptsFlag: '--maven-opts',
    cwd,
    ecosystem: 'maven',
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    verbose,
  })
}
