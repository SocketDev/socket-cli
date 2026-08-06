import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  findBuildToolCandidates,
  realpathOrResolved,
  withoutDisabledFlags,
} from './discover-manifest-roots.mts'
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
  | 'aborted'
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

export type EcosystemBuildConfig = {
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

// Nearest already-confirmed-disabled ancestor of `dir`, if any - lets the
// caller shorten `readSocketJsonCascade`'s walk to start there instead of
// all the way back at `cwd`, without skipping any nested override.
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

// A wrapper-preferred `bin` default is resolved per-root (`dir`, not `cwd`)
// since a wrapper script only exists at the actual build root. Exported for
// reuse by the recursive setup wizard's reactor-coverage pruning.
export function resolveEcosystemConfig(
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

// Generates one .socket.facts.json per independent gradle/sbt/maven build
// root under `cwd`. Coverage is tracked per ecosystem via the facts SBOM's
// own projects[].subprojectDir, not by pruning the whole discovered subtree,
// so an unrelated nested project a reactor doesn't declare still gets its
// own invocation - and only a properly nested subprojectDir counts as
// coverage at all; one that escapes its declaring reactor's own directory
// still gets its own independent invocation too (see the covered.add call
// below). Fail-closed per ecosystem, not globally: a root whose
// workspace layout can't be determined aborts only that ecosystem's own
// remaining walk (marking its untried candidates 'aborted'), since coverage
// is tracked per ecosystem and an unrelated one has nothing to lose from it.
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
  // Candidate dirs come back realpath-resolved (findBuildToolCandidates); cwd
  // must match or every boundary/relative-path comparison below breaks as
  // soon as cwd contains a symlink (macOS /tmp -> /private/tmp, etc.).
  const realCwd = await realpathOrResolved(cwd)
  // A root-disabled ecosystem must still be scanned for - a nested socket.json
  // may re-enable it - so the per-directory cascade below, not this scan, is
  // what actually decides skip vs. include.
  const candidatesByTool = await findBuildToolCandidates({
    cwd,
    excludePaths,
    sockJson: withoutDisabledFlags(rootSockJson),
  })

  const outcomes: RecursiveManifestOutcome[] = []
  for (const [ecosystem, dirs] of candidatesByTool) {
    const covered = new Set<string>()
    const disabledRoots: DisabledRoot[] = []
    for (let dirIndex = 0; dirIndex < dirs.length; dirIndex += 1) {
      const dir = dirs[dirIndex] as string
      if (covered.has(dir)) {
        outcomes.push({ dir, ecosystem, status: 'skippedCovered' })
        continue
      }

      const nearestRoot = nearestDisabledRoot(dir, disabledRoots)
      const sockJson = nearestRoot
        ? readSocketJsonCascade(dir, nearestRoot.dir, nearestRoot.sockJson)
        : readSocketJsonCascade(dir, realCwd, rootSockJson)
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
        { cwd: realCwd, target: dir },
      )

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

      if (result === null) {
        outcomes.push({ dir, ecosystem, status: 'failed' })
        logger.warn(
          `Aborting ${ecosystem} discovery: ${dir}'s workspace layout could not be determined, so its remaining build roots cannot be safely classified as covered or independent.`,
        )
        for (const abortedDir of dirs.slice(dirIndex + 1)) {
          outcomes.push({ dir: abortedDir, ecosystem, status: 'aborted' })
        }
        break
      }
      if (!result) {
        outcomes.push({ dir, ecosystem, status: 'empty' })
        continue
      }

      covered.add(dir)
      // eslint-disable-next-line no-await-in-loop
      const resolvedSubprojectDirs = await Promise.all(
        result.projects.map(project =>
          realpathOrResolved(path.resolve(dir, project.subprojectDir)),
        ),
      )
      for (const subprojectDir of resolvedSubprojectDirs) {
        // Only a genuinely nested member (a descendant of this reactor's own
        // directory) has no independent existence worth its own standalone
        // analysis. A subprojectDir that escapes this reactor's own tree (a
        // sibling, e.g. Maven's `<module>../shared-lib</module>` or Gradle's
        // relocated projectDir) is independently locatable and potentially
        // independently consumed or published - its own un-mediated
        // resolution (e.g. a dependency version this reactor's own
        // dependency management happens to override) is a distinct,
        // meaningful data point, not a redundant one. Never suppress its own
        // build-root invocation, regardless of which reactor(s) also
        // incorporate it or the order candidates happen to be discovered in.
        if (subprojectDir.startsWith(`${dir}${path.sep}`)) {
          covered.add(subprojectDir)
        }
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
