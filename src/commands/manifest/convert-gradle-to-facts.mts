import { runCoanaManifestFacts } from './coana-manifest-facts.mts'

// Generates a `.socket.facts.json` for a Gradle project by delegating to the
// Coana CLI's `manifest gradle` command (which owns the Gradle init script that
// resolves the dependency graph). socket-cli no longer runs gradle itself; an
// explicit `bin` is forwarded as `--bin`, otherwise Coana defaults to
// `./gradlew`.
export async function convertGradleToFacts({
  bin,
  cwd,
  excludeConfigs,
  gradleOpts,
  ignoreUnresolved,
  includeConfigs,
  verbose,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  gradleOpts: string[]
  ignoreUnresolved: boolean
  includeConfigs: string
  verbose: boolean
}): Promise<void> {
  await runCoanaManifestFacts({
    bin,
    buildOpts: gradleOpts,
    buildOptsFlag: '--gradle-opts',
    cwd,
    ecosystem: 'gradle',
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    verbose,
  })
}
