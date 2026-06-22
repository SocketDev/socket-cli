import { runCoanaManifestFacts } from './coana-manifest-facts.mts'

// Generates a `.socket.facts.json` for a .NET project by delegating to the Coana
// CLI's `manifest dotnet` command (which runs a bundled .NET tool that performs
// native NuGet/MSBuild resolution). socket-cli no longer runs dotnet itself; an
// explicit `bin` is forwarded as `--bin` (the dotnet host), otherwise Coana
// defaults to `dotnet` on PATH.
//
// Unlike the JVM tools, the dotnet resolver has no notion of configuration
// filters, so `--include-configs` / `--exclude-configs` are intentionally not
// exposed; only `--ignore-unresolved` and `--dotnet-opts` apply.
export async function convertDotnetToFacts({
  bin,
  cwd,
  dotnetOpts,
  ignoreUnresolved,
  verbose,
}: {
  bin: string
  cwd: string
  dotnetOpts: string[]
  ignoreUnresolved: boolean
  verbose: boolean
}): Promise<void> {
  await runCoanaManifestFacts({
    bin,
    buildOpts: dotnetOpts,
    buildOptsFlag: '--dotnet-opts',
    cwd,
    ecosystem: 'dotnet',
    excludeConfigs: '',
    ignoreUnresolved,
    includeConfigs: '',
    verbose,
  })
}
