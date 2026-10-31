import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  addCoveredBuildFiles,
  buildRootPath,
  findBuildToolCandidates,
  isBuildRootCovered,
  isSolutionCovered,
  realpathOrResolved,
  withoutDisabledFlags,
} from './discover-manifest-roots.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import { runManifestFacts } from './run-manifest-facts.mts'
import { resolveBuildToolBin } from './scripts/build-tool.mts'
import {
  DSI_SETUP_COMMAND,
  REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
} from './scripts/resolution-report-render.mts'
import { skipWithoutDotnetSdk } from './scripts/run.mts'
import { SOCKET_JSON } from '../../constants.mts'
import { loadSocketConfig } from '../../utils/config.mts'
import { withTmpDir } from '../../utils/fs.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
} from '../../utils/socket-json.mts'
import { projectIgnorePathsToReachExcludePaths } from '../scan/exclude-paths.mts'

import type { BuildRoot } from './discover-manifest-roots.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { BuildOption } from './scripts/resolution-report-render.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

export type RecursiveManifestOutcomeStatus =
  | 'aborted'
  | 'empty'
  | 'failed'
  | 'generated'
  | 'skippedCovered'
  | 'skippedDisabled'
  | 'skippedNoSdk'

export type RecursiveManifestOutcome = BuildRoot & {
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
  verbose: boolean
}

// Relative to the user's shell when inside it, else absolute.
function displayPath(file: string): string {
  const rel = path.relative(process.cwd(), file)
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel
}

// A cascaded (not just root-level) disabled additionally skips this one build
// root here, on top of its existing root-only ecosystem-wide meaning for
// auto/gradle/etc. facts:false has no pom-mode equivalent here (facts-only),
// so it skips too.
function getSkipReason(
  ecosystem: BuildTool,
  disabled: boolean | undefined,
  facts?: boolean | undefined,
): string | undefined {
  if (disabled) {
    return `defaults.manifest.${ecosystem}.disabled is true`
  }
  if (facts === false) {
    return `defaults.manifest.${ecosystem}.facts is false (pom mode)`
  }
  return undefined
}

type DisabledRoot = { dir: string; sockJson: SocketJson }

// Maven 3's options starting with `f`; its GnuParser takes a long name after
// one dash too, and splits `-fX` and `-f=X` into `-f X`.
const MAVEN_FILE_OPTS = new Set(['f', 'file'])
const MAVEN_OTHER_F_OPTS = new Set([
  'fae',
  'fail-at-end',
  'fail-fast',
  'fail-never',
  'ff',
  'fn',
])

// Each POM is built by its own `--file`, so a user one is dropped.
function withoutMavenFileOpts(dir: string, opts: string[]): string[] {
  const kept: string[] = []
  for (let i = 0, { length } = opts; i < length; i += 1) {
    const opt = opts[i]!
    const name = opt.replace(/^--?/, '')
    if (opt === name || MAVEN_OTHER_F_OPTS.has(name)) {
      kept.push(opt)
    } else if (MAVEN_FILE_OPTS.has(name)) {
      i += 1
    } else if (
      !MAVEN_FILE_OPTS.has(name.split('=')[0]!) &&
      !(opt.startsWith('-f') && !opt.startsWith('--'))
    ) {
      kept.push(opt)
    }
  }
  if (kept.length !== opts.length) {
    logger.warn(
      `Ignoring --file in mavenOpts for ${dir}: each POM there is built by its own file.`,
    )
  }
  return kept
}

// Nearest already-confirmed-disabled `dir` or ancestor of it, if any - lets the
// caller shorten `readSocketJsonCascade`'s walk to start there instead of
// all the way back at `cwd`, without skipping any nested override.
function nearestDisabledRoot(
  dir: string,
  disabledRoots: readonly DisabledRoot[],
): DisabledRoot | undefined {
  let nearest: DisabledRoot | undefined
  for (const root of disabledRoots) {
    if (
      (dir === root.dir || dir.startsWith(`${root.dir}${path.sep}`)) &&
      (!nearest || root.dir.length > nearest.dir.length)
    ) {
      nearest = root
    }
  }
  return nearest
}

async function runEcosystemCandidates({
  candidatesByTool,
  excludePaths,
  ignoreUnresolved: ignoreUnresolvedOverride,
  optionFlags,
  realCwd,
  rootSockJson,
  sbtTmpDir,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  candidatesByTool: Map<BuildTool, BuildRoot[]>
  excludePaths: string[] | undefined
  ignoreUnresolved: boolean | undefined
  optionFlags: ReadonlySet<BuildOption>
  realCwd: string
  rootSockJson: SocketJson
  // sbt only: a shared global base reused across every sbt root in this run,
  // so sbt's own Scala-toolchain cache under <base>/boot survives between
  // invocations instead of being reprovisioned per root. Undefined when no
  // sbt root was discovered, matching runManifestFacts' own ephemeral default.
  sbtTmpDir: string | undefined
  sidecarAcc: SidecarAccumulator | undefined
  verbose: boolean
  withFiles: boolean | undefined
}): Promise<RecursiveManifestOutcome[]> {
  const outcomes: RecursiveManifestOutcome[] = []
  const covered = new Set<string>()
  // Relative to the scan root: a build can reach modules outside its own
  // directory (Maven `../x` modules, relocated Gradle projects).
  const scanExcludePaths = projectIgnorePathsToReachExcludePaths(excludePaths, {
    cwd: realCwd,
    target: realCwd,
  })
  for (const [ecosystem, roots] of candidatesByTool) {
    const disabledRoots: DisabledRoot[] = []
    const configByDir = new Map<string, EcosystemBuildConfig>()
    for (const { 0: rootIndex, 1: root } of roots.entries()) {
      const { dir, entryFile } = root
      if (isBuildRootCovered(covered, ecosystem, root)) {
        outcomes.push({ ...root, ecosystem, status: 'skippedCovered' })
        continue
      }

      let dirConfig = configByDir.get(dir)
      if (!dirConfig) {
        const nearestRoot = nearestDisabledRoot(dir, disabledRoots)
        const sockJson = nearestRoot
          ? readSocketJsonCascade(dir, nearestRoot.dir, nearestRoot.sockJson)
          : readSocketJsonCascade(dir, realCwd, rootSockJson)
        dirConfig = resolveEcosystemConfig(ecosystem, dir, sockJson)
        configByDir.set(dir, dirConfig)
        if (dirConfig.skipReason) {
          // Only warn for a genuinely new disabled root, not one already
          // covered by an ancestor's warning above - otherwise a big disabled
          // reactor with hundreds of nested poms would spam one warning line
          // per pom for what's really a single root cause. The aggregate
          // count still shows up in the final summary either way.
          if (!nearestRoot) {
            logger.warn(
              `Skipping ${dir} (${ecosystem}): ${dirConfig.skipReason}.`,
            )
          }
          disabledRoots.push({ dir, sockJson })
        }
      }
      const {
        bin,
        buildOpts,
        excludeConfigs,
        ignoreUnresolved,
        includeConfigs,
        javaHome,
        skipReason,
        verbose: configVerbose,
      } = dirConfig
      if (skipReason) {
        outcomes.push({ ...root, ecosystem, status: 'skippedDisabled' })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      if (ecosystem === 'dotnet' && (await skipWithoutDotnetSdk(bin, dir))) {
        outcomes.push({ ...root, ecosystem, status: 'skippedNoSdk' })
        continue
      }
      if (
        // eslint-disable-next-line no-await-in-loop
        await isSolutionCovered(covered, root, {
          bin,
          excludeBase: realCwd,
          excludePaths: scanExcludePaths,
          toolOpts: buildOpts,
        })
      ) {
        outcomes.push({ ...root, ecosystem, status: 'skippedCovered' })
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await runManifestFacts({
        bin,
        buildOpts,
        cwd: dir,
        ecosystem,
        entryFile,
        excludeBase: realCwd,
        excludeConfigs,
        excludePaths: scanExcludePaths,
        hints: {
          continueOnInstallErrorsFlag: withFiles
            ? REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG
            : undefined,
          flags: optionFlags,
          setupCommand: DSI_SETUP_COMMAND,
          socketJson: displayPath(path.join(dir, SOCKET_JSON)),
        },
        ignoreUnresolved: ignoreUnresolvedOverride ?? ignoreUnresolved,
        includeConfigs,
        javaHome,
        sidecarAcc,
        tmpDir: ecosystem === 'sbt' ? sbtTmpDir : undefined,
        verbose: verbose || configVerbose,
        withFiles,
      })

      if (result === null) {
        outcomes.push({ ...root, ecosystem, status: 'failed' })
        const abortedRoots = roots.slice(rootIndex + 1)
        if (abortedRoots.length) {
          logger.warn(
            `Aborting ${ecosystem} discovery: ${buildRootPath(root)} failed to generate Socket facts, and without them the remaining build roots cannot be safely classified as covered or independent.`,
          )
        }
        for (const aborted of abortedRoots) {
          outcomes.push({ ...aborted, ecosystem, status: 'aborted' })
        }
        break
      }
      if (!result) {
        outcomes.push({ ...root, ecosystem, status: 'empty' })
        continue
      }

      // Gradle's `-p` can root the build away from `dir`.
      // eslint-disable-next-line no-await-in-loop
      await addCoveredBuildFiles(
        covered,
        ecosystem,
        path.dirname(result.factsPath),
        result.projects,
      )
      outcomes.push({
        ...root,
        ecosystem,
        factsPath: result.factsPath,
        status: 'generated',
      })
    }
  }
  return outcomes
}

// A failed root aborts only its own ecosystem's remaining walk: the build
// files it would have covered are all its own tool's.
export async function generateRecursiveManifests({
  cwd,
  excludePaths,
  ignoreUnresolved,
  optionFlags = new Set(),
  sbtTmpDir,
  sidecarAcc,
  verbose,
  withFiles,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  // When set, overrides every build root's own socket.json setting.
  ignoreUnresolved?: boolean | undefined
  // Options the invoking command takes as flags; hints send the rest to each
  // build root's socket.json.
  optionFlags?: ReadonlySet<BuildOption> | undefined
  // Reachability path only: caller-supplied directory to use as sbt's shared
  // global base across every sbt root in this run. sbt provisions the Scala
  // toolchain under `<base>/boot`, which withFiles' artifactPaths point into,
  // so when the caller intends to consume those paths after this call
  // returns (e.g. reachability analysis), it must supply a directory that
  // outlives this call and delete it once it's done - mirrors
  // ManifestScriptOptions.tmpDir one level up. Unset ⇒ an ephemeral shared
  // dir is allocated and cleaned up before this call returns, matching
  // runManifestFacts' own withFiles-less default.
  sbtTmpDir?: string | undefined
  // Reachability path only: run build tools with files and fold resolved
  // artifact paths into sidecarAcc, keyed by each root's own factsPath.
  sidecarAcc?: SidecarAccumulator | undefined
  verbose: boolean
  withFiles?: boolean | undefined
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
    socketConfig: loadSocketConfig(cwd),
    sockJson: withoutDisabledFlags(rootSockJson),
  })

  const runAll = (resolvedSbtTmpDir: string | undefined) =>
    runEcosystemCandidates({
      candidatesByTool,
      excludePaths,
      ignoreUnresolved,
      optionFlags,
      realCwd,
      rootSockJson,
      sbtTmpDir: resolvedSbtTmpDir,
      sidecarAcc,
      verbose,
      withFiles,
    })

  // A shared global base across every sbt root in this run lets sbt's own
  // Scala-toolchain cache under <base>/boot survive between invocations
  // instead of being reprovisioned per root (the plugin file is rewritten and
  // records.tsv is removed before every invocation, so reuse is safe). A
  // caller-supplied sbtTmpDir is reused as-is (the caller owns its lifetime);
  // otherwise one is allocated and cleaned up here, but only when there's an
  // sbt root to benefit from sharing it at all.
  const outcomes = sbtTmpDir
    ? await runAll(sbtTmpDir)
    : candidatesByTool.get('sbt')?.length
      ? await withTmpDir('socket-sbt-facts-shared-', runAll)
      : await runAll(undefined)

  if (verbose) {
    logger.info(`Discovered ${outcomes.length} build-tool candidate(s).`)
  }

  return outcomes
}

// A wrapper-preferred `bin` default is resolved per-root (`dir`, not `cwd`)
// since a wrapper script only exists at the actual build root. Exported for
// reuse by the recursive setup wizard's reactor-coverage pruning.
export function resolveEcosystemConfig(
  ecosystem: BuildTool,
  dir: string,
  sockJson: SocketJson,
): EcosystemBuildConfig {
  if (ecosystem === 'dotnet') {
    const config = sockJson.defaults?.manifest?.dotnet
    return {
      bin: config?.bin ?? resolveBuildToolBin('dotnet', dir),
      buildOpts: parseBuildToolOpts(config?.dotnetOpts ?? undefined),
      excludeConfigs: config?.excludeConfigs ?? '',
      ignoreUnresolved: Boolean(config?.ignoreUnresolved),
      includeConfigs: config?.includeConfigs ?? '',
      javaHome: undefined,
      skipReason: getSkipReason(ecosystem, config?.disabled),
      verbose: Boolean(config?.verbose),
    }
  }
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
      skipReason: getSkipReason(ecosystem, config?.disabled, config?.facts),
      verbose: Boolean(config?.verbose),
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
      skipReason: getSkipReason(ecosystem, config?.disabled, config?.facts),
      verbose: Boolean(config?.verbose),
    }
  }
  const config = sockJson.defaults?.manifest?.maven
  const bin = config?.bin ?? undefined
  return {
    bin: bin ?? resolveBuildToolBin('maven', dir),
    buildOpts: withoutMavenFileOpts(
      dir,
      parseBuildToolOpts(config?.mavenOpts ?? undefined),
    ),
    excludeConfigs: config?.excludeConfigs ?? '',
    ignoreUnresolved: Boolean(config?.ignoreUnresolved),
    includeConfigs: config?.includeConfigs ?? '',
    javaHome: config?.javaHome ?? undefined,
    skipReason: getSkipReason(ecosystem, config?.disabled),
    verbose: Boolean(config?.verbose),
  }
}
