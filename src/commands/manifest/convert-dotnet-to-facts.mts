import { logger } from '@socketsecurity/registry/lib/logger'

import { findDotnetEntries } from './detect-manifest-actions.mts'
import { realpathOrResolved } from './discover-manifest-roots.mts'
import { buildUncoveredRoot } from './generate-recursive-manifests.mts'

import type { EcosystemBuildConfig } from './generate-recursive-manifests.mts'
import type { RunManifestFactsOutcome } from './run-manifest-facts.mts'
import type { BuildOptionHints } from './scripts/resolution-report-render.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `<entry>.socket.facts.json` for the given solution or project
// file, or for every solution and project at the top of `cwd`. A project a
// solution there already covers is not built again.
export async function convertDotnetToFacts({
  config,
  cwd,
  entryFile,
  excludePaths,
  hints,
  sidecarAcc,
  withFiles,
}: {
  config: EcosystemBuildConfig
  cwd: string
  // Builds only this file (relative to cwd) when set.
  entryFile?: string | undefined
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  sidecarAcc?: SidecarAccumulator | undefined
  withFiles?: boolean | undefined
}): Promise<RunManifestFactsOutcome> {
  const entries = entryFile ? [entryFile] : findDotnetEntries(cwd)
  if (!entries.length) {
    process.exitCode = 1
    logger.fail(
      `No .NET solution or project file found at \`${cwd}\` (expected a .sln, .slnx, .csproj, .fsproj or .vbproj file).`,
    )
    return null
  }
  const dir = await realpathOrResolved(cwd)
  const covered = new Set<string>()
  let last: RunManifestFactsOutcome
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await buildUncoveredRoot({
      config,
      covered,
      cwd,
      ecosystem: 'dotnet',
      excludePaths,
      hints,
      root: { dir, entryFile: entry },
      sidecarAcc,
      withFiles,
    })
    if (outcome === 'covered') {
      if (config.verbose) {
        logger.info(`Skipping \`${entry}\`: earlier builds cover its projects.`)
      }
      continue
    }
    if (outcome === null) {
      return null
    }
    last = outcome ?? last
  }
  return last
}
