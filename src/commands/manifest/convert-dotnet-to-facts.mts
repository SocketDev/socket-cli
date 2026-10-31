import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { findDotnetEntries } from './detect-manifest-actions.mts'
import {
  addCoveredBuildFiles,
  isBuildRootCovered,
  isSolutionCovered,
  realpathOrResolved,
} from './discover-manifest-roots.mts'
import { runManifestFacts } from './run-manifest-facts.mts'

import type { RunManifestFactsOutcome } from './run-manifest-facts.mts'
import type { BuildOptionHints } from './scripts/resolution-report-render.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'

// Generates `<entry>.socket.facts.json` for the given solution or project
// file, or for every solution and project at the top of `cwd`. A project a
// solution there already covers is not built again.
export async function convertDotnetToFacts({
  bin,
  cwd,
  dotnetOpts,
  entryFile,
  excludeConfigs,
  excludePaths,
  hints,
  ignoreUnresolved,
  includeConfigs,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  bin: string
  cwd: string
  dotnetOpts: string[]
  // Builds only this file (relative to cwd) when set.
  entryFile?: string | undefined
  excludeConfigs: string
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  ignoreUnresolved: boolean
  includeConfigs: string
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
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
    const root = { dir, entryFile: entry }
    if (
      isBuildRootCovered(covered, 'dotnet', root) ||
      // eslint-disable-next-line no-await-in-loop
      (await isSolutionCovered(covered, root, {
        bin,
        excludePaths,
        toolOpts: dotnetOpts,
      }))
    ) {
      if (verbose) {
        logger.info(`Skipping \`${entry}\`: earlier builds cover its projects.`)
      }
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const outcome = await runManifestFacts({
      bin,
      buildOpts: dotnetOpts,
      cwd,
      ecosystem: 'dotnet',
      entryFile: entry,
      excludeConfigs,
      excludePaths,
      hints,
      ignoreUnresolved,
      includeConfigs,
      sidecarAcc,
      verbose,
      withFiles,
    })
    if (outcome === null) {
      return null
    }
    if (outcome) {
      // eslint-disable-next-line no-await-in-loop
      await addCoveredBuildFiles(
        covered,
        'dotnet',
        path.dirname(outcome.factsPath),
        outcome.projects,
      )
      last = outcome
    }
  }
  return last
}
