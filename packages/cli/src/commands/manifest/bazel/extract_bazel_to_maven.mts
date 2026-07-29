/**
 * Maven extraction orchestrator for `socket manifest bazel`: walks the
 * discovered Bazel workspaces, hands each one to the per-workspace processor,
 * aggregates the outcomes into the four-state result, and writes the
 * machine-readable completeness summary.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import { ensureJavaOnPath } from './bazel-java-shim.mts'
import {
  makeOutputUserRoot,
  reapBazelServer,
  removeTempdir,
  writeCompletenessSummary,
} from './bazel-maven-run-support.mts'
import {
  DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES,
  DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES,
} from './bazel-maven-types.mts'
import { processWorkspaceForMaven } from './bazel-maven-workspace.mts'
import { validateOutputBase } from './bazel-output-base-check.mts'
import { provisionPythonShim } from './bazel-python-shim.mts'
import { findWorkspaceRoots } from './bazel-workspace-walk.mts'

import type {
  ExtractBazelOptions,
  ExtractBazelResult,
  ExtractBazelStatus,
  WorkspaceOutcome,
} from './bazel-maven-types.mts'

const logger = getDefaultLogger()

const DEFAULT_PER_REPO_TIMEOUT_MS = 60_000

export async function extractBazelToMaven(
  config: ExtractBazelOptions,
): Promise<ExtractBazelResult> {
  const cfg = { __proto__: null, ...config } as ExtractBazelOptions
  const { cwd, out, verbose } = cfg
  logger.group('bazel2maven:')
  logger.info(`- src dir: \`${cwd}\``)
  logger.info(`- out dir: \`${out}\``)
  if (!existsSync(cwd)) {
    logger.warn(`Warning: cwd does not exist: ${cwd}`)
  }
  logger.groupEnd()

  const perRepoTimeoutMs = cfg.perRepoTimeoutMs ?? DEFAULT_PER_REPO_TIMEOUT_MS

  // Validate config + ensure toolchains BEFORE we mint a tempdir.
  let bin: string
  let baseEnv: NodeJS.ProcessEnv | undefined
  try {
    if (cfg.bazelOutputBase) {
      validateOutputBase(cfg.bazelOutputBase, cfg.cwd)
    }
    await ensureJavaOnPath()
    const shim = await provisionPythonShim()
    baseEnv = shim.augmentedEnv ?? cfg.env
    bin = await resolveBazelBinary(cfg.bin)
  } catch (e) {
    logger.fail(`Unexpected error in bazel2maven: ${errorMessage(e)}`)
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    }
    return {
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'hardFailure',
      workspaceOutcomes: [],
    }
  }
  logger.info(`Using bazel: ${bin}`)

  // Track every output_user_root we mint so we can reap them all in
  // the cleanup pass, even if a per-repo timeout forced a re-mint.
  let outputUserRoot = makeOutputUserRoot()
  const mintedRoots: string[] = [outputUserRoot]
  if (verbose) {
    logger.log(
      `[VERBOSE] initial --output_user_root=${outputUserRoot} (will be reaped on completion)`,
    )
  }

  const layout = cfg.outLayout ?? 'standalone'
  const manifestDir =
    layout === 'flat' ? path.join(out, '.socket-auto-manifest') : out
  // One manifest per (workspace, hub), written best-effort: a single wedged
  // hub must not discard the manifests every other hub produced.
  const manifestPaths: string[] = []
  let totalArtifacts = 0
  let anyRepos = false
  let hubsSucceeded = 0
  let hubsFailed = 0
  // Per-workspace / per-hub analyzability breakdown backing the completeness
  // signal the CLI emits. A run is only `complete` when no workspace failed to
  // load, no probe was indeterminate, and every queried hub succeeded cleanly.
  const workspaceOutcomes: WorkspaceOutcome[] = []
  let anyIndeterminate = false
  let anyWorkspaceLoadFailed = false
  // A hub we deliberately skipped because a committed lockfile already covers
  // it. This is a SUCCESSFUL no-op — the server already ingests that lockfile
  // — so it must not be conflated with "discovered a hub we failed to
  // extract".
  let anyHubCoveredByLockfile = false

  try {
    // Always apply the default prune policy so no caller can forget it;
    // callers EXTEND it via ignoreDirNames/ignoreDirPrefixes.
    const ignoreDirNames = new Set([
      ...DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES,
      ...(cfg.ignoreDirNames ?? []),
    ])
    const ignoreDirPrefixes = [
      ...DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES,
      ...(cfg.ignoreDirPrefixes ?? []),
    ]
    const workspaceRoots = findWorkspaceRoots({
      cwd,
      ignoreDirNames,
      ignoreDirPrefixes,
      verbose,
    })
    if (!workspaceRoots.length) {
      logger.warn(
        `No Bazel workspace found at ${cwd} or beneath (looked for MODULE.bazel / WORKSPACE / WORKSPACE.bazel).`,
      )
      return {
        artifactCount: 0,
        complete: false,
        manifestPaths: [],
        status: 'noEcosystem',
        workspaceOutcomes: [],
      }
    }
    if (verbose) {
      logger.log(
        `[VERBOSE] discovered ${workspaceRoots.length} workspace root(s):`,
        workspaceRoots,
      )
    }

    for (
      let rootIdx = 0, rootCount = workspaceRoots.length;
      rootIdx < rootCount;
      rootIdx += 1
    ) {
      const workspaceRun = await processWorkspaceForMaven({
        baseEnv,
        bin,
        cwd,
        extractOptions: cfg,
        manifestDir,
        outputUserRoot,
        perRepoTimeoutMs,
        verbose,
        workspaceRoot: workspaceRoots[rootIdx]!,
      })
      anyHubCoveredByLockfile ||= workspaceRun.anyHubCoveredByLockfile
      anyIndeterminate ||= workspaceRun.anyIndeterminate
      anyRepos ||= workspaceRun.anyRepos
      anyWorkspaceLoadFailed ||= workspaceRun.workspaceOutcome.load === 'failed'
      hubsFailed += workspaceRun.hubsFailed
      hubsSucceeded += workspaceRun.hubsSucceeded
      manifestPaths.push(...workspaceRun.manifestPaths)
      mintedRoots.push(...workspaceRun.mintedRoots)
      outputUserRoot = workspaceRun.outputUserRoot
      totalArtifacts += workspaceRun.artifactCount
      workspaceOutcomes.push(workspaceRun.workspaceOutcome)
    }

    if (!manifestPaths.length) {
      // Every discovered hub was already covered by a committed lockfile and
      // nothing else needed extraction: writing zero synthetic manifests is
      // the CORRECT complement, not a failure. The run is complete only when
      // no workspace failed to load and no probe was indeterminate.
      if (
        anyHubCoveredByLockfile &&
        !anyRepos &&
        !anyWorkspaceLoadFailed &&
        !anyIndeterminate
      ) {
        logger.success(
          'All discovered Maven hub(s) are already covered by committed lockfiles; nothing to generate.',
        )
        await writeCompletenessSummary({
          artifactCount: 0,
          complete: true,
          manifestDir,
          manifestPaths: [],
          status: 'complete',
          verbose,
          workspaceOutcomes,
        })
        return {
          artifactCount: 0,
          complete: true,
          manifestPaths: [],
          status: 'complete',
          workspaceOutcomes,
        }
      }
      // Nothing was emitted. If nothing was analyzable at all (no repos to
      // extract, no committed-lockfile coverage, no workspace load failure, no
      // indeterminate probe) this is a genuine absence; otherwise it's a hard
      // failure — something was present but we could not extract it.
      if (
        !anyRepos &&
        !anyWorkspaceLoadFailed &&
        !anyIndeterminate &&
        !anyHubCoveredByLockfile
      ) {
        if (verbose) {
          logger.info(
            'No Maven artifacts extracted. failureCategory=no-supported-ecosystem',
          )
        }
        return {
          artifactCount: 0,
          complete: false,
          manifestPaths: [],
          status: 'noEcosystem',
          workspaceOutcomes,
        }
      }
      logger.fail(
        'Discovered or partially analyzed Maven workspace(s) but wrote zero manifests. failureCategory=ecosystem-detected-but-empty',
      )
      await writeCompletenessSummary({
        artifactCount: 0,
        complete: false,
        manifestDir,
        manifestPaths: [],
        status: 'hardFailure',
        verbose,
        workspaceOutcomes,
      })
      return {
        artifactCount: 0,
        complete: false,
        manifestPaths: [],
        status: 'hardFailure',
        workspaceOutcomes,
      }
    }

    // Manifests were written, so the run is not a hard failure. It is only
    // `complete` when every queried hub succeeded cleanly AND no workspace
    // failed to load AND no probe was indeterminate; any of those means the
    // emitted SBOM is known-incomplete and the run is reported partial.
    const knownIncomplete =
      hubsFailed > 0 || anyWorkspaceLoadFailed || anyIndeterminate
    const status: ExtractBazelStatus = knownIncomplete ? 'partial' : 'complete'
    if (status === 'complete') {
      logger.success(
        `Wrote ${manifestPaths.length} manifest(s), ${totalArtifacts} artifact(s) total.`,
      )
    } else {
      const loadNote = anyWorkspaceLoadFailed
        ? ', at least one workspace failed to load'
        : ''
      const indetNote = anyIndeterminate
        ? ', at least one hub could not be classified'
        : ''
      logger.warn(
        `Wrote ${manifestPaths.length} manifest(s), ${totalArtifacts} artifact(s) total — partial run: ${hubsSucceeded} hub(s) succeeded, ${hubsFailed} failed or incomplete${loadNote}${indetNote}. The uploaded SBOM is known-incomplete.`,
      )
    }
    if (verbose) {
      logger.log('[VERBOSE] outputs:', {
        anyIndeterminate,
        anyWorkspaceLoadFailed,
        artifactCount: totalArtifacts,
        hubsFailed,
        hubsSucceeded,
        layout,
        manifestPaths,
        status,
      })
    }
    await writeCompletenessSummary({
      artifactCount: totalArtifacts,
      complete: status === 'complete',
      manifestDir,
      manifestPaths,
      status,
      verbose,
      workspaceOutcomes,
    })
    return {
      artifactCount: totalArtifacts,
      complete: status === 'complete',
      manifestPaths,
      status,
      workspaceOutcomes,
    }
  } catch (e) {
    logger.fail(`Unexpected error in bazel2maven: ${errorMessage(e)}`)
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    } else {
      logger.info('Re-run with --verbose for the full stack.')
    }
    return {
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'hardFailure',
      workspaceOutcomes,
    }
  } finally {
    for (
      let dirIdx = 0, dirCount = mintedRoots.length;
      dirIdx < dirCount;
      dirIdx += 1
    ) {
      const dir = mintedRoots[dirIdx]!
      await reapBazelServer(bin, dir, { verbose })
      await removeTempdir(dir, { verbose })
    }
  }
}
