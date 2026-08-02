import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { findBuildToolCandidates } from './discover-manifest-roots.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import { runManifestFacts } from './run-manifest-facts.mts'
import { resolveBuildToolBin } from './scripts/build-tool.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
} from '../../utils/socket-json.mts'
import { projectIgnorePathsToReachExcludePaths } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

export type RecursiveManifestOutcomeStatus =
  | 'empty'
  | 'failed'
  | 'generated'
  | 'skippedCovered'
  | 'skippedDisabled'

export type RecursiveManifestOutcome = {
  dir: string
  ecosystem: BuildTool
  factsPath?: string | undefined
  status: RecursiveManifestOutcomeStatus
}

type EcosystemBuildConfig = {
  bin: string
  buildOpts: string[]
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  javaHome: string | undefined
  // Set when this build root should be skipped entirely (never invoked).
  skipReason: string | undefined
}

// A cascaded (not just root-level) disabled additionally skips this one build
// root here, on top of its existing root-only ecosystem-wide meaning for
// auto/gradle/etc. facts:false has no pom-mode equivalent here (facts-only),
// so it skips too.
function getSkipReason(
  disabled: boolean | undefined,
  facts?: boolean | undefined,
): string | undefined {
  if (disabled) {
    return 'defaults.manifest.<ecosystem>.disabled is true'
  }
  if (facts === false) {
    return 'defaults.manifest.<ecosystem>.facts is false (pom mode)'
  }
  return undefined
}

type DisabledRoot = { dir: string; sockJson: SocketJson }

// Nearest already-confirmed-disabled ancestor of `dir` (if any): lets the
// caller shorten `readSocketJsonCascade`'s walk to start there instead of
// all the way back at `cwd`. A build root with hundreds of nested candidates
// (a big disabled legacy reactor, say) would otherwise re-walk the same long
// ancestor chain from `cwd` for every single one. Correctness is unaffected
// - the shortened walk still checks every directory between `dir` and the
// chosen boundary, so a nested override (re-enabling a specific subproject)
// is still honored - it's just cheaper when nothing overrides it, which is
// the common case. Picks the deepest (nearest) match if several qualify.
function nearestDisabledRoot(
  dir: string,
  disabledRoots: readonly DisabledRoot[],
): DisabledRoot | undefined {
  let nearest: DisabledRoot | undefined
  for (const root of disabledRoots) {
    if (
      dir.startsWith(`${root.dir}${path.sep}`) &&
      (!nearest || root.dir.length > nearest.dir.length)
    ) {
      nearest = root
    }
  }
  return nearest
}

// Resolves this build root's effective per-ecosystem build-tool config from
// its cascaded socket.json; a wrapper-preferred `bin` default is resolved
// per-root (`dir`, not `cwd`) since a wrapper script only exists at the
// actual build root.
function resolveEcosystemConfig(
  ecosystem: BuildTool,
  dir: string,
  sockJson: SocketJson,
): EcosystemBuildConfig {
  if (ecosystem === 'sbt') {
    const config = sockJson.defaults?.manifest?.sbt
    const bin = config?.bin ?? undefined
    return {
      bin: bin ?? 'sbt',
      buildOpts: parseBuildToolOpts(config?.sbtOpts ?? undefined),
      excludeConfigs: config?.excludeConfigs ?? '',
      ignoreUnresolved: Boolean(config?.ignoreUnresolved),
      includeConfigs: config?.includeConfigs ?? '',
      javaHome: config?.javaHome ?? undefined,
      skipReason: getSkipReason(config?.disabled, config?.facts),
    }
  }
  if (ecosystem === 'gradle') {
    const config = sockJson.defaults?.manifest?.gradle
    const bin = config?.bin ?? undefined
    return {
      bin: bin ? path.resolve(dir, bin) : resolveBuildToolBin('gradle', dir),
      buildOpts: parseBuildToolOpts(config?.gradleOpts ?? undefined),
      excludeConfigs: config?.excludeConfigs ?? '',
      ignoreUnresolved: Boolean(config?.ignoreUnresolved),
      includeConfigs: config?.includeConfigs ?? '',
      javaHome: config?.javaHome ?? undefined,
      skipReason: getSkipReason(config?.disabled, config?.facts),
    }
  }
  const config = sockJson.defaults?.manifest?.maven
  const bin = config?.bin ?? undefined
  return {
    bin: bin ?? resolveBuildToolBin('maven', dir),
    buildOpts: parseBuildToolOpts(config?.mavenOpts ?? undefined),
    excludeConfigs: config?.excludeConfigs ?? '',
    ignoreUnresolved: Boolean(config?.ignoreUnresolved),
    includeConfigs: config?.includeConfigs ?? '',
    javaHome: config?.javaHome ?? undefined,
    skipReason: getSkipReason(config?.disabled),
  }
}

// Recursively discovers gradle/sbt/maven build roots under `cwd` and
// generates one `.socket.facts.json` per independent build root. Coverage is
// tracked per ecosystem (not globally) using the facts SBOM's own
// `projects[].subprojectDir` — never by pruning an entire discovered
// subtree — so a reactor/multi-project member is skipped on re-encounter
// while an unrelated nested project the reactor doesn't declare (e.g. a
// stray git-submodule pom, or a different-ecosystem project nested inside a
// covered directory tree) still gets its own invocation. Fail-closed: a build
// root whose workspace layout couldn't be determined (the build tool crashed
// or a blocking resolution failure prevented `projects[]` from being read)
// aborts the entire walk instead of continuing to its still-undiscovered
// descendants - without that root's `projects[]`, there's no way to tell
// whether a later candidate is one of its own already-covered members or a
// genuinely independent project, and guessing risks silently mis-scanning a
// subproject as standalone (or vice versa) plus a cascade of doomed attempts
// against a build that's already known to be broken.
export async function generateRecursiveManifests({
  cwd,
  excludePaths,
  verbose,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  verbose: boolean
}): Promise<RecursiveManifestOutcome[]> {
  const rootSockJson = readOrDefaultSocketJson(cwd)
  const candidatesByTool = await findBuildToolCandidates({
    cwd,
    excludePaths,
    sockJson: rootSockJson,
  })

  const outcomes: RecursiveManifestOutcome[] = []
  ecosystems: for (const [ecosystem, dirs] of candidatesByTool) {
    const covered = new Set<string>()
    const disabledRoots: DisabledRoot[] = []
    for (const dir of dirs) {
      if (covered.has(dir)) {
        outcomes.push({ dir, ecosystem, status: 'skippedCovered' })
        continue
      }

      const nearestRoot = nearestDisabledRoot(dir, disabledRoots)
      const sockJson = nearestRoot
        ? readSocketJsonCascade(dir, nearestRoot.dir, nearestRoot.sockJson)
        : readSocketJsonCascade(dir, cwd, rootSockJson)
      const {
        bin,
        buildOpts,
        excludeConfigs,
        ignoreUnresolved,
        includeConfigs,
        javaHome,
        skipReason,
      } = resolveEcosystemConfig(ecosystem, dir, sockJson)

      if (skipReason) {
        // Only warn for a genuinely new disabled root, not one already
        // covered by an ancestor's warning above - otherwise a big disabled
        // reactor with hundreds of nested poms would spam one warning line
        // per pom for what's really a single root cause. The aggregate
        // count still shows up in the final summary either way.
        if (!nearestRoot) {
          logger.warn(`Skipping ${dir} (${ecosystem}): ${skipReason}.`)
        }
        outcomes.push({ dir, ecosystem, status: 'skippedDisabled' })
        disabledRoots.push({ dir, sockJson })
        continue
      }

      const excludePathsForRoot = projectIgnorePathsToReachExcludePaths(
        excludePaths,
        { cwd, target: dir },
      )

      const beforeExitCode = process.exitCode
      // eslint-disable-next-line no-await-in-loop
      const result = await runManifestFacts({
        bin,
        buildOpts,
        cwd: dir,
        ecosystem,
        excludeConfigs,
        excludePaths: excludePathsForRoot,
        ignoreUnresolved,
        includeConfigs,
        javaHome,
        verbose,
      })

      if (!result) {
        const failed = Boolean(
          process.exitCode && process.exitCode !== beforeExitCode,
        )
        outcomes.push({
          dir,
          ecosystem,
          status: failed ? 'failed' : 'empty',
        })
        if (failed) {
          logger.warn(
            `Aborting recursive discovery: ${dir}'s (${ecosystem}) workspace layout could not be determined, so remaining build roots cannot be safely classified as covered or independent.`,
          )
          break ecosystems
        }
        continue
      }

      covered.add(dir)
      for (const project of result.projects) {
        covered.add(path.resolve(dir, project.subprojectDir))
      }
      outcomes.push({
        dir,
        ecosystem,
        factsPath: result.factsPath,
        status: 'generated',
      })
    }
  }

  if (verbose) {
    logger.info(`Discovered ${outcomes.length} build-tool candidate(s).`)
  }

  return outcomes
}
