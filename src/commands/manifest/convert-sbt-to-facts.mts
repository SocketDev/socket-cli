import { runCoanaManifestFacts } from './coana-manifest-facts.mts'

// Generates a `.socket.facts.json` for an sbt project by delegating to the
// Coana CLI's `manifest sbt` command (which owns the sbt plugin that resolves
// the dependency graph). socket-cli no longer runs sbt itself; an explicit
// `bin` is forwarded as `--bin`, otherwise Coana defaults to `sbt` on PATH.
// JDK-compatibility guidance (sbt 0.13/early 1.x cannot run on modern JDKs) is
// handled by Coana; pass a compatible JDK via `--sbt-opts "--java-home <path>"`
// or `JAVA_HOME`.
export async function convertSbtToFacts({
  bin,
  cwd,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  sbtOpts,
  verbose,
}: {
  bin: string
  cwd: string
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  sbtOpts: string[]
  verbose: boolean
}): Promise<void> {
  await runCoanaManifestFacts({
    bin,
    buildOpts: sbtOpts,
    buildOptsFlag: '--sbt-opts',
    cwd,
    ecosystem: 'sbt',
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    verbose,
  })
}
