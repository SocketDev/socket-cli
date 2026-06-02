import { runCoanaManifestFacts } from './coana-manifest-facts.mts'

// Generates a `.socket.facts.json` for a Gradle project by delegating to the
// Coana CLI's `manifest gradle` command (which owns the Gradle init script that
// resolves the dependency graph). socket-cli no longer runs gradle itself; an
// explicit `bin` is forwarded as `--bin`, otherwise Coana defaults to
// `./gradlew`.
export async function convertGradleToFacts({
  bin,
  configs,
  cwd,
  gradleOpts,
  ignoreUnresolved,
  verbose,
}: {
  bin: string
  configs: string
  cwd: string
  gradleOpts: string[]
  ignoreUnresolved: boolean
  verbose: boolean
}): Promise<void> {
  await runCoanaManifestFacts({
    bin,
    buildOpts: gradleOpts,
    buildOptsFlag: '--gradle-opts',
    configs,
    cwd,
    ecosystem: 'gradle',
    ignoreUnresolved,
    verbose,
  })
}
