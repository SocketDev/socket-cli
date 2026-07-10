import { runManifestFacts } from './run-manifest-facts.mts'

import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `.socket.facts.json` for a .NET project by running `dotnet restore`
// and parsing the resulting `project.assets.json` files.
export async function convertDotnetToFacts({
  bin,
  cwd,
  dotnetOpts,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  dotnetOpts: string[]
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
}): Promise<void> {
  await runManifestFacts({
    bin,
    buildOpts: dotnetOpts,
    cwd,
    ecosystem: 'dotnet',
    excludeConfigs,
    ignoreUnresolved,
    includeConfigs,
    sidecarAcc,
    verbose,
    withFiles,
  })
}
