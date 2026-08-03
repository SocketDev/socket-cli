/**
 * Per-workspace Maven extraction for the Bazel pipeline: detect the workspace
 * mode, discover its Maven hubs, run the per-hub metadata cquery, and write
 * one synthetic manifest per hub. One call handles exactly one workspace root;
 * the orchestrator loops over the discovered roots.
 */
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runMetadataCqueryForRepo } from './bazel-cquery.mts'
import { discoverCandidatesForWorkspace } from './bazel-maven-discovery.mts'
import {
  committedLockfileCovers,
  hubManifestFileName,
  writeHubManifest,
} from './bazel-maven-manifest.mts'
import {
  buildQueryOpts,
  makeOutputUserRoot,
  reapBazelServer,
  removeTempdir,
} from './bazel-maven-run-support.mts'
import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'

import type { CqueryRepoResult } from './bazel-cquery.mts'
import type { WriteHubManifestResult } from './bazel-maven-manifest.mts'
import type {
  ExtractBazelOptions,
  HubOutcome,
  WorkspaceOutcome,
} from './bazel-maven-types.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'
import type { WorkspaceMode } from './bazel-workspace-detect.mts'

const logger = getDefaultLogger()

// Aggregates one workspace contributes back to the run. `outputUserRoot`
// carries the CURRENT server root — a per-hub timeout reaps the wedged server
// and mints a fresh root, and every minted root is reported via `mintedRoots`
// so the orchestrator can reap them all in its cleanup pass.
export type WorkspaceRunResult = {
  anyHubCoveredByLockfile: boolean
  anyIndeterminate: boolean
  anyRepos: boolean
  artifactCount: number
  hubsFailed: number
  hubsSucceeded: number
  manifestPaths: string[]
  mintedRoots: string[]
  outputUserRoot: string
  workspaceOutcome: WorkspaceOutcome
}

// Process one workspace root end-to-end. Never throws for per-workspace
// failures — a workspace that cannot load is reported via
// `workspaceOutcome.load === 'failed'` so the run degrades to partial or
// hard failure instead of aborting sibling workspaces.
export async function processWorkspaceForMaven(config: {
  baseEnv: NodeJS.ProcessEnv | undefined
  bin: string
  cwd: string
  extractOptions: ExtractBazelOptions
  manifestDir: string
  outputUserRoot: string
  perRepoTimeoutMs: number
  verbose: boolean
  workspaceRoot: string
}): Promise<WorkspaceRunResult> {
  const {
    baseEnv,
    bin,
    cwd,
    extractOptions,
    manifestDir,
    perRepoTimeoutMs,
    verbose,
    workspaceRoot,
  } = { __proto__: null, ...config } as typeof config
  let { outputUserRoot } = config
  const relPath = path.relative(cwd, workspaceRoot)
  const hubOutcomes: HubOutcome[] = []
  const manifestPaths: string[] = []
  const mintedRoots: string[] = []
  let artifactCount = 0
  let anyHubCoveredByLockfile = false
  let anyIndeterminate = false
  let anyRepos = false
  let hubsFailed = 0
  let hubsSucceeded = 0

  let mode: WorkspaceMode
  try {
    mode = detectWorkspaceMode(workspaceRoot)
  } catch (e) {
    // A workspace we cannot even read is a load failure, NOT "no Maven
    // here": record it so the run is flagged not-complete rather than
    // silently skipped.
    const reason = errorMessage(e)
    if (verbose) {
      logger.log(
        `[VERBOSE] workspace ${workspaceRoot}: load failed (${reason})`,
      )
    }
    logger.warn(
      `Workspace ${relPath || '.'}: failed to load (${reason}); it could not be analyzed.`,
    )
    return {
      anyHubCoveredByLockfile,
      anyIndeterminate,
      anyRepos,
      artifactCount,
      hubsFailed,
      hubsSucceeded,
      manifestPaths,
      mintedRoots,
      outputUserRoot,
      workspaceOutcome: {
        hubs: [],
        load: 'failed',
        reason,
        relPath,
      },
    }
  }
  logger.info(
    `Workspace ${relPath || '.'}: bzlmod=${mode.bzlmod} workspace=${mode.workspace}`,
  )
  const invocationFlags = getBazelInvocationFlags(mode)
  const queryOptsFor = (userRoot: string): BazelQueryOptions =>
    buildQueryOpts({
      baseEnv,
      bin,
      extractOptions,
      invocationFlags,
      outputUserRoot: userRoot,
      spawnCwd: workspaceRoot,
      verbose,
    })

  const { candidates, discoveryIndeterminate, indeterminateProbes } =
    await discoverCandidatesForWorkspace(
      workspaceRoot,
      mode,
      queryOptsFor(outputUserRoot),
      { verbose },
    )
  // Authoritative hub enumeration failed to execute (e.g. `bazel mod
  // show_extension` errored under Bzlmod): custom-named hubs may have been
  // missed, so the run can never be complete. Record it as an
  // indeterminate hub outcome under a synthetic name so the completeness
  // signal carries the gap.
  if (discoveryIndeterminate) {
    anyIndeterminate = true
    hubOutcomes.push({
      hub: '(enumeration)',
      reason: 'show-extension-failed',
      state: 'indeterminate',
    })
    logger.warn(
      `Workspace ${relPath || '.'}: Maven hub enumeration failed; custom-named hubs may be missing. The run is reported known-incomplete.`,
    )
  }
  for (
    let probeIdx = 0, probeCount = indeterminateProbes.length;
    probeIdx < probeCount;
    probeIdx += 1
  ) {
    anyIndeterminate = true
    hubOutcomes.push({
      hub: indeterminateProbes[probeIdx]!,
      reason: 'probe-indeterminate',
      state: 'indeterminate',
    })
  }
  logger.info(
    `Workspace ${relPath || '.'}: discovered ${candidates.length} Maven repo(s): ${
      candidates.join(', ') || '(none)'
    }`,
  )
  for (
    let candIdx = 0, candCount = candidates.length;
    candIdx < candCount;
    candIdx += 1
  ) {
    const repoName = candidates[candIdx]!
    // Committed-lockfile gate: the server-side walker already ingests any
    // committed maven_install.json / <hub>_maven_install.json under the
    // workspace; the CLI's synthetic manifest is the COMPLEMENT, not a
    // duplicate. Skip emitting when a committed lockfile already covers
    // this hub. A skip is a successful no-op — the server already ingests
    // that lockfile — so it runs BEFORE `anyRepos` is flipped (which marks
    // "a hub we needed to extract").
    const committed = committedLockfileCovers({
      fileName: hubManifestFileName(repoName),
      manifestDir,
      workspaceRoot,
    })
    if (committed) {
      anyHubCoveredByLockfile = true
      logger.info(
        `@${repoName}: committed lockfile already covers this hub (${path.relative(cwd, committed) || committed}); skipping synthetic manifest.`,
      )
      hubOutcomes.push({
        hub: repoName,
        reason: 'committed-lockfile',
        state: 'skipped-lockfile',
      })
      if (verbose) {
        logger.log(
          `[VERBOSE] @${repoName}: skipped (committed lockfile at ${committed})`,
        )
      }
      continue
    }
    // We are about to extract this hub: it is a real candidate we must
    // analyze, so mark the ecosystem present.
    anyRepos = true
    if (verbose) {
      logger.log(
        `[VERBOSE] workspace ${relPath || '.'}: running metadata cquery for @${repoName} (timeout ${perRepoTimeoutMs}ms)`,
      )
    }
    const result: CqueryRepoResult = await runMetadataCqueryForRepo({
      options: queryOptsFor(outputUserRoot),
      repoName,
      timeoutMs: perRepoTimeoutMs,
      workspaceRelPath: relPath,
      workspaceRoot,
    })
    if (result.status === 'timeout') {
      logger.warn(
        `@${repoName}: cquery timed out after ${perRepoTimeoutMs}ms; reaping server`,
      )
      hubsFailed += 1
      hubOutcomes.push({
        hub: repoName,
        reason: 'cquery-timeout',
        state: 'failed',
      })
      await reapBazelServer(bin, outputUserRoot, { verbose })
      await removeTempdir(outputUserRoot, { verbose })
      outputUserRoot = makeOutputUserRoot()
      mintedRoots.push(outputUserRoot)
      if (verbose) {
        logger.log(
          `[VERBOSE] minted fresh --output_user_root=${outputUserRoot} after timeout`,
        )
      }
      continue
    }
    if (result.status === 'error') {
      logger.warn(`@${repoName}: cquery failed; skipping this hub`)
      hubsFailed += 1
      hubOutcomes.push({
        hub: repoName,
        reason: 'cquery-error',
        state: 'failed',
      })
      continue
    }
    // A scan must never silently upload a graph missing edges it knows
    // it dropped: warn unconditionally and treat the hub as partial.
    let hubPartial = result.unresolvedLabels.length > 0
    if (hubPartial) {
      logger.warn(
        `@${repoName}: dropped ${result.unresolvedLabels.length} unresolved dependency edge(s): ${result.unresolvedLabels.join(', ')}`,
      )
    }
    // A non-zero cquery exit that still yielded a usable subset
    // (--keep_going) is reported as `partial` even with no unresolved
    // labels — the graph is known-incomplete, so flip the hub partial.
    if (result.status === 'partial' && !result.unresolvedLabels.length) {
      hubPartial = true
      logger.warn(
        `@${repoName}: cquery partially failed (--keep_going); the dependency graph may be incomplete`,
      )
    }
    let written: WriteHubManifestResult
    try {
      written = await writeHubManifest({
        artifacts: result.artifacts,
        manifestDir,
        relPath,
        repoName,
      })
    } catch (e) {
      // Best-effort per hub: a write failure must not abort the walk and
      // discard the manifests other hubs already produced.
      logger.warn(
        `@${repoName}: failed to write manifest (${errorMessage(e)}); skipping this hub`,
      )
      hubsFailed += 1
      hubOutcomes.push({
        hub: repoName,
        reason: 'manifest-write-failed',
        state: 'failed',
      })
      continue
    }
    if (written.droppedArtifacts.length) {
      hubPartial = true
      logger.warn(
        `@${repoName}: dropped ${written.droppedArtifacts.length} malformed Maven coordinate(s): ${written.droppedArtifacts.join(', ')}`,
      )
    }
    if (written.prunedEdges.length) {
      hubPartial = true
      logger.warn(
        `@${repoName}: pruned ${written.prunedEdges.length} dependency edge(s) referencing unlisted artifacts: ${written.prunedEdges.join(', ')}`,
      )
    }
    if (written.manifestPath) {
      manifestPaths.push(written.manifestPath)
      artifactCount += written.artifactCount
      if (hubPartial) {
        hubsFailed += 1
        hubOutcomes.push({
          hub: repoName,
          reason: 'incomplete-graph',
          state: 'failed',
        })
      } else {
        hubsSucceeded += 1
        hubOutcomes.push({ hub: repoName, state: 'populated' })
      }
      if (verbose) {
        logger.log(
          `[VERBOSE] @${repoName}: status=${result.status}, ${written.artifactCount} artifact(s) -> ${written.manifestPath}`,
        )
      }
    } else {
      // No artifacts to write (empty hub). Not itself a failure, but if
      // edges were dropped the partial signal still applies.
      if (hubPartial) {
        hubsFailed += 1
        hubOutcomes.push({
          hub: repoName,
          reason: 'incomplete-graph',
          state: 'failed',
        })
      } else {
        hubOutcomes.push({ hub: repoName, state: 'empty' })
      }
      if (verbose) {
        logger.log(
          `[VERBOSE] @${repoName}: status=${result.status} (no manifest written)`,
        )
      }
    }
  }
  if (verbose) {
    for (
      let outIdx = 0, outCount = hubOutcomes.length;
      outIdx < outCount;
      outIdx += 1
    ) {
      const outcome = hubOutcomes[outIdx]!
      logger.log(
        `[VERBOSE] workspace ${relPath || '.'} hub @${outcome.hub}: ${outcome.state}${
          outcome.reason ? ` (${outcome.reason})` : ''
        }`,
      )
    }
  }
  return {
    anyHubCoveredByLockfile,
    anyIndeterminate,
    anyRepos,
    artifactCount,
    hubsFailed,
    hubsSucceeded,
    manifestPaths,
    mintedRoots,
    outputUserRoot,
    workspaceOutcome: {
      hubs: hubOutcomes,
      load: 'loaded',
      relPath,
    },
  }
}
