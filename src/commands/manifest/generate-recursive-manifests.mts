import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  buildsSetting,
  createBuildRootSettingsResolver,
  describeDisabledBy,
  displayPath,
  socketJsonPath,
} from './build-root-config.mts'
import {
  addMembership,
  buildRootPath,
  emptyMembership,
  findBuildToolCandidates,
  hasRootMarker,
  isBuildCovered,
  isBuildRootCovered,
  isPathInside,
  isRootCovered,
  membershipOf,
  realpathOrResolved,
  unionMemberships,
  withoutDisabledFlags,
} from './discover-manifest-roots.mts'
import { loadBuild, withModules } from './load-build.mts'
import { parseBuildToolOpts } from './parse-build-tool-opts.mts'
import {
  DSI_SETUP_COMMAND,
  EXCLUDE_PATHS_FLAG,
  REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
  keepFacts,
  runManifestFacts,
} from './run-manifest-facts.mts'
import { BUILD_FILES, resolveBuildToolBin } from './scripts/build-tool.mts'
import { loadSocketConfig } from '../../utils/config.mts'
import { withTmpDir } from '../../utils/fs.mts'
import { getOrInsert } from '../../utils/get-or-insert.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { ResolvedBuildRootSettings } from './build-root-config.mts'
import type {
  BuildRoot,
  Membership,
  RootBuildOptions,
} from './discover-manifest-roots.mts'
import type { LoadedBuild } from './load-build.mts'
import type {
  BuildOption,
  BuildOptionHints,
  ReachabilitySettings,
  RunManifestFactsOutcome,
  RunManifestFactsResult,
  SocketFactsContext,
  SocketFactsRunOptions,
  SocketFactsWorkDir,
} from './run-manifest-facts.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

export type RecursiveManifestOutcomeStatus =
  | 'aborted'
  | 'empty'
  | 'failed'
  | 'generated'
  | 'skippedCovered'
  | 'skippedDisabled'

export type RecursiveManifestOutcome = BuildRoot & {
  // The facts file of a run that was dropped, which no kept run wrote: it holds
  // no kept build's facts, so it must not be collected.
  discardedFactsPath?: string | undefined
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
  // Maven's `--file` in mavenOpts, which buildOpts leaves out.
  mavenFile: string | undefined
  // Set when this build root should be skipped entirely (never invoked).
  skipReason: string | undefined
  verbose: boolean
}

// A cascaded (not just root-level) disabled additionally skips this one build
// root here, on top of its existing root-only ecosystem-wide meaning for
// auto/gradle/etc. facts:false has no pom-mode equivalent here (facts-only),
// so it skips too.
// Only Gradle and sbt take `facts: false`, which generates pom files instead.
export function getSkipReason(
  ecosystem: BuildTool,
  section:
    | { disabled?: boolean | undefined; facts?: boolean | undefined }
    | undefined,
): string | undefined {
  if (section?.disabled) {
    return `defaults.manifest.${ecosystem}.disabled is true`
  }
  if (
    (ecosystem === 'gradle' || ecosystem === 'sbt') &&
    section?.facts === false
  ) {
    return `defaults.manifest.${ecosystem}.facts is false (pom mode)`
  }
  return undefined
}

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

// Maven 3.9 builds the first of several `--file`s.
function splitMavenFileOpts(opts: string[]): {
  file: string | undefined
  opts: string[]
} {
  const files: string[] = []
  const kept: string[] = []
  for (let i = 0, { length } = opts; i < length; i += 1) {
    const opt = opts[i]!
    const name = opt.replace(/^--?/, '')
    const { 0: key, 1: value } = name.split(/=(.*)/s)
    if (opt === name || MAVEN_OTHER_F_OPTS.has(name)) {
      kept.push(opt)
    } else if (MAVEN_FILE_OPTS.has(name)) {
      i += 1
      if (i < length) {
        files.push(opts[i]!)
      }
    } else if (MAVEN_FILE_OPTS.has(key!) && value !== undefined) {
      files.push(value)
    } else if (opt.startsWith('-f') && !opt.startsWith('--')) {
      files.push(opt.slice(2).replace(/^=/, ''))
    } else {
      kept.push(opt)
    }
  }
  return { file: files[0], opts: kept }
}

type Candidate = {
  index: number
  // A build of its own (see hasRootMarker): covered only by the builds that
  // load everything it loads, which only running it tells.
  marker: boolean
  root: BuildRoot
}

type Run = Candidate & {
  membership: Membership
  // Undefined when the build had nothing to resolve.
  result: RunManifestFactsResult | undefined
}

// A build skipped by its own `builds` entry, loaded to skip what it loads.
type Load = Candidate & LoadedBuild

type WalkContext = {
  // Every run writes into the work dir, so a dropped run leaves the facts
  // file at its target as it was.
  context: SocketFactsContext & { workDir: SocketFactsWorkDir }
  excludePaths: string[] | undefined
  ignoreUnresolved: boolean | undefined
  optionFlags: ReadonlySet<BuildOption>
  realCwd: string
  resolveSettings: (
    tool: BuildTool,
    root: BuildRoot,
  ) => ResolvedBuildRootSettings
  verbose: boolean
}

type Loader = { path: string; skipped: boolean }

// What loads a build another build covers, for messages.
function describeLoader(loader: Loader | undefined): string {
  return loader?.skipped
    ? `it is part of ${loader.path}, which is skipped`
    : `${loader?.path ?? 'another build'} builds it`
}

function statusOf(loader: Loader | undefined): RecursiveManifestOutcomeStatus {
  return loader?.skipped ? 'skippedDisabled' : 'skippedCovered'
}

// The options a build's listings take besides the build itself.
export function buildListingOptions(
  config: Pick<EcosystemBuildConfig, 'bin' | 'buildOpts'>,
  excludeBase: string | undefined,
  excludePaths: string[] | undefined,
  context?: SocketFactsContext | undefined,
): RootBuildOptions {
  return {
    bin: config.bin,
    buildOpts: config.buildOpts,
    context,
    excludeBase,
    excludePaths,
  }
}

export function socketFactsRunOptions(
  ecosystem: BuildTool,
  root: BuildRoot,
  config: EcosystemBuildConfig,
  {
    context,
    excludeBase,
    excludePaths,
    hints,
    reachability,
  }: {
    context?: SocketFactsContext | undefined
    excludeBase: string | undefined
    excludePaths: string[] | undefined
    hints?: BuildOptionHints | undefined
    reachability?: ReachabilitySettings | undefined
  },
): SocketFactsRunOptions {
  return {
    bin: config.bin,
    buildOpts: config.buildOpts,
    context,
    cwd: root.dir,
    ecosystem,
    entryFile: root.entryFile,
    excludeBase,
    excludeConfigs: config.excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved: config.ignoreUnresolved,
    includeConfigs: config.includeConfigs,
    javaHome: config.javaHome,
    reachability,
    verbose: config.verbose,
  }
}

async function everyAsync<T>(
  items: readonly T[],
  test: (item: T) => Promise<boolean>,
): Promise<boolean> {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await test(item))) {
      return false
    }
  }
  return true
}

// Order-independent: a run that a later build turns out to load is dropped.
async function walkTool(
  ctx: WalkContext,
  ecosystem: BuildTool,
  roots: readonly BuildRoot[],
): Promise<RecursiveManifestOutcome[]> {
  const buildFiles = BUILD_FILES[ecosystem]
  const candidates: Candidate[] = roots.map((root, index) => ({
    index,
    marker: hasRootMarker(ecosystem, root),
    root,
  }))
  // The tool run in a directory without a root marker loads the build of the
  // nearest ancestor that has one, so that build's skip applies to it.
  const ancestorBuild = candidates.map(candidate => {
    if (
      buildFiles.byFile ||
      !buildFiles.loadsAncestorBuild ||
      buildFiles.loadsAncestorBuild.except.includes(
        path.basename(candidate.root.dir),
      ) ||
      candidate.marker
    ) {
      return undefined
    }
    let nearest: Candidate | undefined
    for (const other of candidates) {
      if (
        other.marker &&
        other.root.dir !== candidate.root.dir &&
        isPathInside(other.root.dir, candidate.root.dir) &&
        (!nearest || other.root.dir.length > nearest.root.dir.length)
      ) {
        nearest = other
      }
    }
    return nearest
  })

  const resolvedFor = ({ root }: Candidate) =>
    ctx.resolveSettings(ecosystem, root)
  const configs = new Map<string, EcosystemBuildConfig>()
  const configFor = (candidate: Candidate): EcosystemBuildConfig => {
    const { entryKey, sockJson } = resolvedFor(candidate)
    const { dir } = candidate.root
    // Builds sharing a directory and its settings resolve them once.
    return getOrInsert(configs, `${dir}\0${entryKey ?? ''}`, () =>
      resolveWalkConfig(ecosystem, dir, sockJson),
    )
  }

  // 'load' when the build's own entry skips it, 'skip' when a directory
  // setting or the build it belongs to does.
  const skips = new Map<number, 'load' | 'skip' | undefined>()
  const warnedSkips = new Set<string>()
  const warnOnce = (message: string) => {
    if (!warnedSkips.has(message)) {
      warnedSkips.add(message)
      logger.warn(message)
    }
  }
  const skipOf = (candidate: Candidate): 'load' | 'skip' | undefined =>
    getOrInsert(skips, candidate.index, () => {
      const { disabledBy } = resolvedFor(candidate)
      const { skipReason } = configFor(candidate)
      const ancestor = ancestorBuild[candidate.index]
      if (disabledBy?.key) {
        return 'load'
      }
      if (skipReason) {
        // One line per setting, not per build root it skips.
        warnOnce(
          disabledBy
            ? `Skipping ${ecosystem} builds in and beneath ${displayPath(disabledBy.dir)}: ${describeDisabledBy(ecosystem, disabledBy)}.`
            : `Skipping ${buildRootPath(candidate.root)} (${ecosystem}): ${skipReason}.`,
        )
        return 'skip'
      }
      return ancestor && skipOf(ancestor) ? 'skip' : undefined
    })

  const scriptOpts = (candidate: Candidate) =>
    buildListingOptions(
      configFor(candidate),
      ctx.realCwd,
      ctx.excludePaths,
      ctx.context,
    )

  // A solution the SDK cannot read, built through its twin instead.
  const superseded = new Map<number, Promise<boolean>>()
  const isSuperseded = (candidate: Candidate): Promise<boolean> =>
    getOrInsert(superseded, candidate.index, async () =>
      ecosystem === 'dotnet'
        ? await isRootCovered(
            emptyMembership(),
            ecosystem,
            candidate.root,
            scriptOpts(candidate),
          )
        : false,
    )

  const isCovered = (covered: Membership, candidate: Candidate) =>
    isBuildCovered(covered, ecosystem, candidate.root, scriptOpts(candidate))
  const isRunCovered = (covered: Membership, run: Run) =>
    isBuildCovered(
      covered,
      ecosystem,
      run.root,
      scriptOpts(run),
      run.membership,
    )
  // Whether a build loads `candidate`'s project, even one that is a build of
  // its own: what excuses its failure.
  const isLoadedBy = (covered: Membership, candidate: Candidate) =>
    isRootCovered(covered, ecosystem, candidate.root, scriptOpts(candidate))
  const isCheaplyCovered = (covered: Membership, candidate: Candidate) =>
    !candidate.marker && isBuildRootCovered(covered, ecosystem, candidate.root)

  const runs = new Map<number, Run>()
  const loads = new Map<number, Load>()
  const failures: Candidate[] = []

  // Drops, latest first, each run the others or the skipped builds cover
  // while every run dropped before stays covered.
  const keptRuns = async (): Promise<Run[]> => {
    const ordered = [...runs.values()].sort((a, b) => a.index - b.index)
    const kept = new Set(ordered)
    const dropped: Run[] = []
    const skipped = [...loads.values()].map(load => load.membership)
    // How many kept runs and skipped builds load each path: only a run whose
    // own paths another loads too can be covered, so most skip the union.
    const loaders = new Map<string, number>()
    const count = (membership: Membership, by: 1 | -1) => {
      for (const key of [...membership.dirs, ...membership.files]) {
        loaders.set(key, (loaders.get(key) ?? 0) + by)
      }
    }
    const loadedByOthers = (run: Run, key: string) =>
      (loaders.get(key) ?? 0) -
        (run.membership.dirs.has(key) || run.membership.files.has(key)
          ? 1
          : 0) >
      0
    // Covering a run takes another loading its root or something it loads.
    const mayBeCovered = (run: Run): boolean =>
      [
        buildRootPath(run.root),
        ...(buildFiles.byFile
          ? []
          : buildFiles.names.map(name => path.join(run.root.dir, name))),
        run.root.dir,
        ...run.membership.dirs,
        ...run.membership.files,
      ].some(key => loadedByOthers(run, key))
    for (const membership of [...skipped, ...ordered.map(r => r.membership)]) {
      count(membership, 1)
    }
    const latestFirst = [...ordered].sort((a, b) => b.index - a.index)
    for (const run of latestFirst) {
      if (!mayBeCovered(run)) {
        continue
      }
      const others = unionMemberships([
        ...skipped,
        ...[...kept]
          .filter(other => other !== run)
          .map(other => other.membership),
      ])
      if (
        // eslint-disable-next-line no-await-in-loop
        (await isRunCovered(others, run)) &&
        // eslint-disable-next-line no-await-in-loop
        (await everyAsync(dropped, done => isRunCovered(others, done)))
      ) {
        kept.delete(run)
        dropped.push(run)
        count(run.membership, -1)
      }
    }
    return ordered.filter(run => kept.has(run))
  }

  let kept: Run[] = []
  let coverage = emptyMembership()
  let skippedCoverage = emptyMembership()
  let uncoveredFailures: Candidate[] = []
  // Set when a run or load is added: only then can coverage change.
  let unsettled = false
  const settle = async () => {
    if (unsettled) {
      unsettled = false
      kept = await keptRuns()
      coverage = unionMemberships(kept.map(run => run.membership))
      skippedCoverage = unionMemberships(
        [...loads.values()].map(load => load.membership),
      )
    }
    const stillFailed: Candidate[] = []
    for (const failure of failures) {
      if (
        // eslint-disable-next-line no-await-in-loop
        !(await isLoadedBy(coverage, failure)) &&
        // eslint-disable-next-line no-await-in-loop
        !(await isLoadedBy(skippedCoverage, failure))
      ) {
        stillFailed.push(failure)
      }
    }
    uncoveredFailures = stillFailed
  }
  const isAborted = (candidate: Candidate) =>
    uncoveredFailures.some(
      failure =>
        failure !== candidate &&
        isPathInside(failure.root.dir, candidate.root.dir),
    )

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    await settle()
    let next: Candidate | undefined
    for (const candidate of candidates) {
      const { index } = candidate
      if (
        runs.has(index) ||
        loads.has(index) ||
        failures.includes(candidate) ||
        isAborted(candidate) ||
        isCheaplyCovered(coverage, candidate) ||
        isCheaplyCovered(skippedCoverage, candidate) ||
        skipOf(candidate) === 'skip' ||
        // eslint-disable-next-line no-await-in-loop
        (await isSuperseded(candidate)) ||
        // eslint-disable-next-line no-await-in-loop
        (await isCovered(coverage, candidate)) ||
        // eslint-disable-next-line no-await-in-loop
        (await isCovered(skippedCoverage, candidate))
      ) {
        continue
      }
      next = candidate
      break
    }
    if (!next) {
      break
    }
    if (skipOf(next) === 'load') {
      // eslint-disable-next-line no-await-in-loop
      const loaded = await loadBuild({
        ...runOptions(ctx, ecosystem, next, configFor(next)),
        scanRoot: ctx.realCwd,
      })
      const why = describeDisabledBy(ecosystem, resolvedFor(next).disabledBy!)
      if (loaded) {
        loads.set(next.index, { ...next, ...loaded })
        unsettled = true
      } else {
        failures.push(next)
        logger.fail(
          `Could not load ${buildRootPath(next.root)} to tell which builds to skip with it (${why}). Fix its settings, or skip its whole directory instead, with \`${DSI_SETUP_COMMAND}\`.`,
        )
      }
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const run = await runCandidate(ctx, ecosystem, next, configFor(next))
    if (run) {
      runs.set(next.index, run)
      unsettled = true
    } else {
      failures.push(next)
    }
  }

  // The first kept run, or else skipped build, that loads `candidate`.
  const loaderOf = async (
    candidate: Candidate,
  ): Promise<Loader | undefined> => {
    const ownRun = runs.get(candidate.index)
    const loaders: Array<{
      membership: Membership
      root: BuildRoot
      skipped: boolean
    }> = [
      ...kept
        .filter(run => run !== ownRun)
        .map(run => ({ ...run, skipped: false })),
      ...[...loads.values()].map(load => ({ ...load, skipped: true })),
    ]
    for (const loader of loaders) {
      if (
        // eslint-disable-next-line no-await-in-loop
        await (ownRun
          ? isRunCovered(loader.membership, ownRun)
          : isLoadedBy(loader.membership, candidate))
      ) {
        return { path: buildRootPath(loader.root), skipped: loader.skipped }
      }
    }
    return undefined
  }

  const keptSet = new Set(kept)
  const keptTargets = new Set(kept.map(run => run.result?.targetPath))
  const outcomes: RecursiveManifestOutcome[] = []
  for (const candidate of candidates) {
    const { index, root } = candidate
    const run = runs.get(index)
    if (run && keptSet.has(run)) {
      if (run.result) {
        // eslint-disable-next-line no-await-in-loop
        await keepFacts(ctx.context.workDir, run.result)
      }
      outcomes.push({
        ...root,
        ecosystem,
        ...(run.result ? { factsPath: run.result.targetPath } : {}),
        status: run.result ? 'generated' : 'empty',
      })
      continue
    }
    let status: RecursiveManifestOutcomeStatus
    let discardedFactsPath: string | undefined
    if (run) {
      // eslint-disable-next-line no-await-in-loop
      const loader = await loaderOf(candidate)
      if (run.result) {
        logger.info(
          `Dropping the Socket facts of ${buildRootPath(root)}: ${describeLoader(loader)}.`,
        )
        if (!keptTargets.has(run.result.targetPath)) {
          discardedFactsPath = run.result.targetPath
        }
      }
      status = statusOf(loader)
    } else if (loads.has(index)) {
      // eslint-disable-next-line no-await-in-loop
      if (await isCovered(coverage, candidate)) {
        status = 'skippedCovered'
      } else {
        status = 'skippedDisabled'
        logger.warn(
          `Skipping ${withModules(buildRootPath(root), loads.get(index)!.modules)}: ${describeDisabledBy(ecosystem, resolvedFor(candidate).disabledBy!)}.`,
        )
      }
    } else if (failures.includes(candidate)) {
      if (uncoveredFailures.includes(candidate)) {
        status = 'failed'
      } else {
        // eslint-disable-next-line no-await-in-loop
        const loader = await loaderOf(candidate)
        if (skipOf(candidate) !== 'load') {
          logger.info(
            `${buildRootPath(root)} failed to generate Socket facts on its own, but ${describeLoader(loader)}, so its failure is ignored.`,
          )
        }
        status = statusOf(loader)
      }
      // eslint-disable-next-line no-await-in-loop
    } else if (await isCovered(coverage, candidate)) {
      status = 'skippedCovered'
      // eslint-disable-next-line no-await-in-loop
    } else if (await isCovered(skippedCoverage, candidate)) {
      status = 'skippedDisabled'
    } else if (isAborted(candidate)) {
      status = 'aborted'
    } else if (skipOf(candidate)) {
      status = 'skippedDisabled'
    } else {
      // A solution the SDK cannot read, built through its twin.
      status = 'skippedCovered'
    }
    if (status === 'skippedCovered') {
      // eslint-disable-next-line no-await-in-loop
      await warnUnappliedEntry(candidate, resolvedFor(candidate).entryKey, () =>
        loaderOf(candidate),
      )
    }
    outcomes.push({
      ...root,
      ...(discardedFactsPath ? { discardedFactsPath } : {}),
      ecosystem,
      status,
    })
  }

  for (const failure of uncoveredFailures) {
    const aborted = candidates.filter(
      candidate =>
        isAborted(candidate) &&
        !failures.includes(candidate) &&
        isPathInside(failure.root.dir, candidate.root.dir),
    )
    if (aborted.length) {
      logger.warn(
        `Not building ${aborted.length} ${ecosystem} build root(s) in or under ${displayPath(failure.root.dir)}: ${buildRootPath(failure.root)} failed, and without it they cannot be told apart from its modules.`,
      )
    }
  }
  return outcomes
}

// A build root's own entry applies to nothing when another build loads it:
// that build resolves it with its own settings.
async function warnUnappliedEntry(
  candidate: Candidate,
  entryKey: string | undefined,
  loaderOf: () => Promise<{ path: string } | undefined>,
): Promise<void> {
  if (!entryKey) {
    return
  }
  const loader = await loaderOf()
  logger.warn(
    `${buildsSetting(entryKey)} in ${socketJsonPath(candidate.root.dir)} does not apply: ${loader?.path ?? 'another build'} builds ${buildRootPath(candidate.root)} with its own settings.`,
  )
}

// Shared by listing and generation, so both run the same Coana, org and hints.
function runOptions(
  ctx: WalkContext,
  ecosystem: BuildTool,
  { root }: Candidate,
  dirConfig: EcosystemBuildConfig,
): SocketFactsRunOptions {
  return {
    ...socketFactsRunOptions(ecosystem, root, dirConfig, {
      context: ctx.context,
      // Relative to the scan root: a build can reach modules outside its own
      // directory (Maven `../x` modules, relocated Gradle projects).
      excludeBase: ctx.realCwd,
      excludePaths: ctx.excludePaths,
      hints: {
        continueOnInstallErrorsFlag: ctx.context.workDir.withFiles
          ? REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG
          : undefined,
        excludePathsFlag: EXCLUDE_PATHS_FLAG,
        flags: ctx.optionFlags,
        setupCommand: DSI_SETUP_COMMAND,
        socketJson: socketJsonPath(root.dir),
      },
    }),
    ignoreUnresolved: ctx.ignoreUnresolved ?? dirConfig.ignoreUnresolved,
    verbose: ctx.verbose || dirConfig.verbose,
  }
}

async function runCandidate(
  ctx: WalkContext,
  ecosystem: BuildTool,
  candidate: Candidate,
  dirConfig: EcosystemBuildConfig,
): Promise<Run | undefined> {
  const options = runOptions(ctx, ecosystem, candidate, dirConfig)
  if (ctx.context.workDir.withFiles) {
    options.reachability = ctx
      .resolveSettings(ecosystem, candidate.root)
      .reachability()
  }
  const result = await runManifestFacts(options)
  if (result === null) {
    return undefined
  }
  return {
    ...candidate,
    membership: result
      ? await membershipOf(result.projects, ctx.realCwd)
      : emptyMembership(),
    result,
  }
}

// Builds `root` unless earlier builds cover it, then adds what it loaded to
// `covered` and keeps its facts.
export async function buildUncoveredRoot({
  config,
  context,
  covered,
  cwd,
  ecosystem,
  excludeBase,
  excludePaths,
  hints,
  reachability,
  root,
}: {
  config: EcosystemBuildConfig
  context?: SocketFactsContext | undefined
  covered: Membership
  // Where the build runs, as the user named it; `root.dir` by default.
  cwd?: string | undefined
  ecosystem: BuildTool
  excludeBase?: string | undefined
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  reachability?: ReachabilitySettings | undefined
  root: BuildRoot
}): Promise<RunManifestFactsOutcome | 'covered'> {
  if (
    await isRootCovered(
      covered,
      ecosystem,
      root,
      buildListingOptions(config, excludeBase, excludePaths, context),
    )
  ) {
    return 'covered'
  }
  const result = await runManifestFacts({
    ...socketFactsRunOptions(ecosystem, root, config, {
      context,
      excludeBase,
      excludePaths,
      hints,
      reachability,
    }),
    cwd: cwd ?? root.dir,
  })
  if (result) {
    await keepFacts(context?.workDir, result)
    addMembership(covered, await membershipOf(result.projects))
  }
  return result
}

// A failure fails the walk only when no kept or skipped build loads it.
export async function generateRecursiveManifests({
  context = {},
  cwd,
  excludePaths,
  ignoreUnresolved,
  optionFlags = new Set(),
  purlTypes,
  verbose,
}: {
  // Without a work dir, the walk writes into one of its own.
  context?: SocketFactsContext | undefined
  cwd: string
  excludePaths?: string[] | undefined
  // When set, overrides every build root's own socket.json setting.
  ignoreUnresolved?: boolean | undefined
  // Options the invoking command takes as flags; hints send the rest to each
  // build root's socket.json.
  optionFlags?: ReadonlySet<BuildOption> | undefined
  purlTypes?: readonly PURL_Type[] | undefined
  verbose: boolean
}): Promise<RecursiveManifestOutcome[]> {
  const rootSockJson = readOrDefaultSocketJson(cwd)
  // Candidate dirs come back realpath-resolved (findBuildToolCandidates); cwd
  // must match or every boundary/relative-path comparison below breaks as
  // soon as cwd contains a symlink (macOS /tmp -> /private/tmp, etc.).
  const realCwd = await realpathOrResolved(cwd)
  // A nested socket.json may re-enable an ecosystem the root disables, so the
  // per-root settings below decide skips, not this scan.
  const candidatesByTool = await findBuildToolCandidates({
    cwd,
    excludePaths,
    purlTypes,
    socketConfig: loadSocketConfig(cwd),
    sockJson: withoutDisabledFlags(rootSockJson),
  })
  const resolveSettings = createBuildRootSettingsResolver()
  // Invalid settings fail the scan before any build runs.
  for (const { 0: tool, 1: roots } of candidatesByTool) {
    for (const root of roots) {
      const settings = resolveSettings(tool, root)
      if (
        context.workDir?.withFiles &&
        !getSkipReason(tool, settings.sockJson.defaults?.manifest?.[tool])
      ) {
        settings.reachability()
      }
    }
  }
  // A failure another build excuses leaves the exit code it set.
  const exitCodeBefore = process.exitCode

  const walk = async (workDir: SocketFactsWorkDir) => {
    const ctx: WalkContext = {
      context: { ...context, workDir },
      excludePaths,
      ignoreUnresolved,
      optionFlags,
      realCwd,
      resolveSettings,
      verbose,
    }
    const outcomes: RecursiveManifestOutcome[] = []
    for (const { 0: ecosystem, 1: roots } of candidatesByTool) {
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(...(await walkTool(ctx, ecosystem, roots)))
    }
    return outcomes
  }
  const outcomes = context.workDir
    ? await walk(context.workDir)
    : await withTmpDir('socket-facts-work-', dir =>
        walk({ dir, entries: new Map(), withFiles: false }),
      )

  if (!outcomes.some(o => o.status === 'failed')) {
    process.exitCode = exitCodeBefore
  }

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
      bin: config?.bin || resolveBuildToolBin('dotnet', dir),
      buildOpts: parseBuildToolOpts(config?.dotnetOpts ?? undefined),
      excludeConfigs: config?.excludeConfigs ?? '',
      ignoreUnresolved: Boolean(config?.ignoreUnresolved),
      includeConfigs: config?.includeConfigs ?? '',
      javaHome: undefined,
      mavenFile: undefined,
      skipReason: getSkipReason(ecosystem, config),
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
      mavenFile: undefined,
      skipReason: getSkipReason(ecosystem, config),
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
      mavenFile: undefined,
      skipReason: getSkipReason(ecosystem, config),
      verbose: Boolean(config?.verbose),
    }
  }
  const config = sockJson.defaults?.manifest?.maven
  const bin = config?.bin ?? undefined
  const { file, opts } = splitMavenFileOpts(
    parseBuildToolOpts(config?.mavenOpts ?? undefined),
  )
  return {
    bin: bin ?? resolveBuildToolBin('maven', dir),
    buildOpts: opts,
    excludeConfigs: config?.excludeConfigs ?? '',
    ignoreUnresolved: Boolean(config?.ignoreUnresolved),
    includeConfigs: config?.includeConfigs ?? '',
    javaHome: config?.javaHome ?? undefined,
    mavenFile: file,
    skipReason: getSkipReason(ecosystem, config),
    verbose: Boolean(config?.verbose),
  }
}

// A walk builds each POM by its own file, so a `--file` in mavenOpts is
// ignored.
export function resolveWalkConfig(
  ecosystem: BuildTool,
  dir: string,
  sockJson: SocketJson,
): EcosystemBuildConfig {
  const config = resolveEcosystemConfig(ecosystem, dir, sockJson)
  if (config.mavenFile !== undefined) {
    logger.warn(
      `Ignoring --file in mavenOpts for ${dir}: each POM there is built by its own file.`,
    )
  }
  return config
}
