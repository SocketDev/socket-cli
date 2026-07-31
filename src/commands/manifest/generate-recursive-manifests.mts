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
  | 'skippedIgnored'

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

// facts:false has no pom-mode equivalent here (facts-only), so it skips too.
function getSkipReason(
  ignored: boolean | undefined,
  facts?: boolean | undefined,
): string | undefined {
  if (ignored) {
    return 'defaults.manifest.<ecosystem>.ignored is true'
  }
  if (facts === false) {
    return 'defaults.manifest.<ecosystem>.facts is false (pom mode)'
  }
  return undefined
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
    return {
      bin: config?.bin ?? 'sbt',
      buildOpts: parseBuildToolOpts(config?.sbtOpts),
      excludeConfigs: config?.excludeConfigs ?? '',
      ignoreUnresolved: Boolean(config?.ignoreUnresolved),
      includeConfigs: config?.includeConfigs ?? '',
      javaHome: config?.javaHome,
      skipReason: getSkipReason(config?.ignored, config?.facts),
    }
  }
  if (ecosystem === 'gradle') {
    const config = sockJson.defaults?.manifest?.gradle
    return {
      bin: config?.bin
        ? path.resolve(dir, config.bin)
        : resolveBuildToolBin('gradle', dir),
      buildOpts: parseBuildToolOpts(config?.gradleOpts),
      excludeConfigs: config?.excludeConfigs ?? '',
      ignoreUnresolved: Boolean(config?.ignoreUnresolved),
      includeConfigs: config?.includeConfigs ?? '',
      javaHome: config?.javaHome,
      skipReason: getSkipReason(config?.ignored, config?.facts),
    }
  }
  const config = sockJson.defaults?.manifest?.maven
  return {
    bin: config?.bin ?? resolveBuildToolBin('maven', dir),
    buildOpts: parseBuildToolOpts(config?.mavenOpts),
    excludeConfigs: config?.excludeConfigs ?? '',
    ignoreUnresolved: Boolean(config?.ignoreUnresolved),
    includeConfigs: config?.includeConfigs ?? '',
    javaHome: config?.javaHome,
    skipReason: getSkipReason(config?.ignored),
  }
}

// Recursively discovers gradle/sbt/maven build roots under `cwd` and
// generates one `.socket.facts.json` per independent build root. Coverage is
// tracked per ecosystem (not globally) using the facts SBOM's own
// `projects[].subprojectDir` — never by pruning an entire discovered
// subtree — so a reactor/multi-project member is skipped on re-encounter
// while an unrelated nested project the reactor doesn't declare (e.g. a
// stray git-submodule pom, or a different-ecosystem project nested inside a
// covered directory tree) still gets its own invocation. A failure at one
// root does not stop discovery/generation at sibling roots.
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
  for (const [ecosystem, dirs] of candidatesByTool) {
    const covered = new Set<string>()
    for (const dir of dirs) {
      if (covered.has(dir)) {
        outcomes.push({ dir, ecosystem, status: 'skippedCovered' })
        continue
      }

      const sockJson = readSocketJsonCascade(dir, cwd, rootSockJson)
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
        logger.warn(`Skipping ${dir} (${ecosystem}): ${skipReason}.`)
        outcomes.push({ dir, ecosystem, status: 'skippedIgnored' })
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
