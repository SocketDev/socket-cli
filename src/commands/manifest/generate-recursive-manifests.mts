import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
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
import { runManifestFacts } from './run-manifest-facts.mts'
import {
  BUILD_FILES,
  resolveBuildToolBin,
  socketFactsFileName,
} from './scripts/build-tool.mts'
import {
  DSI_SETUP_COMMAND,
  REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG,
} from './scripts/resolution-report-render.mts'
import { loadSocketConfig } from '../../utils/config.mts'
import { withTmpDir } from '../../utils/fs.mts'
import { getOrInsert } from '../../utils/get-or-insert.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { ResolvedBuildRootSettings } from './build-root-config.mts'
import type { BuildRoot, Membership } from './discover-manifest-roots.mts'
import type { LoadedBuild } from './load-build.mts'
import type {
  RunManifestFactsOutcome,
  RunManifestFactsResult,
} from './run-manifest-facts.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type {
  BuildOption,
  BuildOptionHints,
} from './scripts/resolution-report-render.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

function normalizePathKey(value: string): string {
  return value.replaceAll('\\', '/')
}

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
  // Set when this build root should be skipped entirely (never invoked).
  skipReason: string | undefined
  verbose: boolean
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

type Candidate = {
  index: number
  // A build of its own (see hasRootMarker): covered only by the builds that
  // load everything it loads, which only running it tells.
  marker: boolean
  root: BuildRoot
}

type SidecarEntry = NonNullable<ReturnType<SidecarAccumulator['get']>>

// A copy of a facts file, if there was one, and its sidecar entry.
type FactsState = {
  facts: string | undefined
  sidecar: SidecarEntry | undefined
}

type Run = Candidate & {
  // The facts file's real path.
  factsKey: string | undefined
  membership: Membership
  // What the run wrote, written back once the walk keeps it.
  output: FactsState | undefined
  // Undefined when the build had nothing to resolve.
  result: RunManifestFactsResult | undefined
}

// A build skipped by its own `builds` entry, loaded to skip what it loads.
type Load = Candidate & LoadedBuild

type WalkContext = {
  backupDir: () => Promise<string>
  excludePaths: string[] | undefined
  // What each facts file held before the walk, by real path; undefined when a
  // run wrote it away from its own directory (Gradle's `-p`) before it was
  // saved.
  originals: Map<string, FactsState | undefined>
  ignoreUnresolved: boolean | undefined
  optionFlags: ReadonlySet<BuildOption>
  realCwd: string
  resolveSettings: (
    tool: BuildTool,
    root: BuildRoot,
  ) => ResolvedBuildRootSettings
  sbtTmpDir: string | undefined
  sidecarAcc: SidecarAccumulator | undefined
  verbose: boolean
  withFiles: boolean | undefined
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

// The options the build-tool scripts take besides the build itself.
export function buildToolScriptOptions(
  config: Pick<EcosystemBuildConfig, 'bin' | 'buildOpts'>,
  excludeBase: string | undefined,
  excludePaths: string[] | undefined,
) {
  return {
    bin: config.bin,
    excludeBase,
    excludePaths,
    toolOpts: config.buildOpts,
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
      resolveEcosystemConfig(ecosystem, dir, sockJson),
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
    buildToolScriptOptions(configFor(candidate), ctx.realCwd, ctx.excludePaths)

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
        const normalized = normalizePathKey(key)
        loaders.set(normalized, (loaders.get(normalized) ?? 0) + by)
      }
    }
    const loadedByOthers = (run: Run, key: string) =>
      (loaders.get(normalizePathKey(key)) ?? 0) -
        ([...run.membership.dirs, ...run.membership.files].some(
          candidate => normalizePathKey(candidate) === normalizePathKey(key),
        )
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
        config: configFor(next),
        ecosystem,
        excludePaths: ctx.excludePaths,
        root: next.root,
        scanRoot: ctx.realCwd,
        verbose: ctx.verbose,
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
  const keptKeys = new Set(kept.map(run => run.factsKey))
  const outcomes: RecursiveManifestOutcome[] = []
  for (const candidate of candidates) {
    const { index, root } = candidate
    const run = runs.get(index)
    if (run && keptSet.has(run)) {
      if (run.result) {
        // eslint-disable-next-line no-await-in-loop
        await putFacts(ctx, run.result.factsPath, run.factsKey!, run.output)
      }
      outcomes.push({
        ...root,
        ecosystem,
        ...(run.result ? { factsPath: run.result.factsPath } : {}),
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
        if (!keptKeys.has(run.factsKey)) {
          discardedFactsPath = run.factsKey
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

async function runCandidate(
  ctx: WalkContext,
  ecosystem: BuildTool,
  candidate: Candidate,
  dirConfig: EcosystemBuildConfig,
): Promise<Run | undefined> {
  const { root } = candidate
  const expectedFactsPath = path.join(
    root.dir,
    socketFactsFileName(ecosystem, root.entryFile) ?? '',
  )
  const expectedKey = await realpathOrResolved(expectedFactsPath)
  if (!ctx.originals.has(expectedKey)) {
    ctx.originals.set(
      expectedKey,
      await saveFacts(
        ctx,
        expectedFactsPath,
        expectedKey,
        `${ecosystem}-${candidate.index}`,
      ),
    )
  }
  const result = await runManifestFacts({
    bin: dirConfig.bin,
    buildOpts: dirConfig.buildOpts,
    cwd: root.dir,
    ecosystem,
    entryFile: root.entryFile,
    // Relative to the scan root: a build can reach modules outside its own
    // directory (Maven `../x` modules, relocated Gradle projects).
    excludeBase: ctx.realCwd,
    excludeConfigs: dirConfig.excludeConfigs,
    excludePaths: ctx.excludePaths,
    hints: {
      continueOnInstallErrorsFlag: ctx.withFiles
        ? REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG
        : undefined,
      flags: ctx.optionFlags,
      setupCommand: DSI_SETUP_COMMAND,
      socketJson: socketJsonPath(root.dir),
    },
    ignoreUnresolved: ctx.ignoreUnresolved ?? dirConfig.ignoreUnresolved,
    includeConfigs: dirConfig.includeConfigs,
    javaHome: dirConfig.javaHome,
    sidecarAcc: ctx.sidecarAcc,
    tmpDir: ecosystem === 'sbt' ? ctx.sbtTmpDir : undefined,
    verbose: ctx.verbose || dirConfig.verbose,
    withFiles: ctx.withFiles,
  })
  if (result === null) {
    return undefined
  }
  let factsKey: string | undefined
  let output: FactsState | undefined
  if (result) {
    factsKey = await realpathOrResolved(result.factsPath)
    output = await saveFacts(
      ctx,
      result.factsPath,
      factsKey,
      `${ecosystem}-${candidate.index}.out`,
    )
    if (!ctx.originals.has(factsKey)) {
      ctx.originals.set(factsKey, undefined)
    }
    await putFacts(ctx, result.factsPath, factsKey, ctx.originals.get(factsKey))
  }
  return {
    ...candidate,
    factsKey,
    // Gradle's `-p` can root the build away from `root.dir`.
    membership: result
      ? await membershipOf(
          path.dirname(result.factsPath),
          result.projects,
          ctx.realCwd,
        )
      : emptyMembership(),
    output,
    result: result ?? undefined,
  }
}

// Puts `state` in place of a facts file and its sidecar entry; an unknown state
// leaves the file and drops the entry.
async function putFacts(
  ctx: WalkContext,
  file: string,
  key: string,
  state: FactsState | undefined,
): Promise<void> {
  if (state?.sidecar) {
    ctx.sidecarAcc?.set(key, state.sidecar)
  } else {
    ctx.sidecarAcc?.delete(key)
  }
  if (!state) {
    return
  }
  if (state.facts) {
    await fs.copyFile(state.facts, file)
  } else {
    await fs.rm(file, { force: true })
  }
}

async function saveFacts(
  ctx: WalkContext,
  file: string,
  key: string,
  name: string,
): Promise<FactsState> {
  let facts: string | undefined
  if (existsSync(file)) {
    facts = path.join(await ctx.backupDir(), name)
    await fs.copyFile(file, facts)
  }
  return { facts, sidecar: ctx.sidecarAcc?.get(key) }
}

// Builds `root` unless earlier builds cover it, then adds what it loaded to
// `covered`.
export async function buildUncoveredRoot({
  config,
  covered,
  cwd,
  ecosystem,
  excludeBase,
  excludePaths,
  hints,
  root,
  sidecarAcc,
  tmpDir,
  withFiles,
}: {
  config: EcosystemBuildConfig
  covered: Membership
  // Where the build runs, as the user named it; `root.dir` by default.
  cwd?: string | undefined
  ecosystem: BuildTool
  excludeBase?: string | undefined
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  root: BuildRoot
  sidecarAcc?: SidecarAccumulator | undefined
  tmpDir?: string | undefined
  withFiles?: boolean | undefined
}): Promise<RunManifestFactsOutcome | 'covered'> {
  const { bin, buildOpts } = config
  if (
    await isRootCovered(
      covered,
      ecosystem,
      root,
      buildToolScriptOptions(config, excludeBase, excludePaths),
    )
  ) {
    return 'covered'
  }
  const result = await runManifestFacts({
    bin,
    buildOpts,
    cwd: cwd ?? root.dir,
    ecosystem,
    entryFile: root.entryFile,
    excludeBase,
    excludeConfigs: config.excludeConfigs,
    excludePaths,
    hints,
    ignoreUnresolved: config.ignoreUnresolved,
    includeConfigs: config.includeConfigs,
    javaHome: config.javaHome,
    sidecarAcc,
    tmpDir,
    verbose: config.verbose,
    withFiles,
  })
  if (result) {
    addMembership(
      covered,
      await membershipOf(path.dirname(result.factsPath), result.projects),
    )
  }
  return result
}

// A failure fails the walk only when no kept or skipped build loads it.
export async function generateRecursiveManifests({
  cwd,
  excludePaths,
  ignoreUnresolved,
  optionFlags = new Set(),
  purlTypes,
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
  purlTypes?: readonly PURL_Type[] | undefined
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
      resolveSettings(tool, root)
    }
  }
  // A failure another build excuses leaves the exit code it set.
  const exitCodeBefore = process.exitCode

  let backupDir: string | undefined
  const runAll = async (resolvedSbtTmpDir: string | undefined) => {
    const ctx: WalkContext = {
      backupDir: async () => {
        backupDir ??= await fs.mkdtemp(
          path.join(tmpdir(), 'socket-facts-backup-'),
        )
        return backupDir
      },
      excludePaths,
      ignoreUnresolved,
      optionFlags,
      originals: new Map(),
      realCwd,
      resolveSettings,
      sbtTmpDir: resolvedSbtTmpDir,
      sidecarAcc,
      verbose,
      withFiles,
    }
    const outcomes: RecursiveManifestOutcome[] = []
    for (const { 0: ecosystem, 1: roots } of candidatesByTool) {
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(...(await walkTool(ctx, ecosystem, roots)))
    }
    return outcomes
  }

  // A shared global base across every sbt root in this run lets sbt's own
  // Scala-toolchain cache under <base>/boot survive between invocations
  // instead of being reprovisioned per root (the plugin file is rewritten and
  // records.tsv is removed before every invocation, so reuse is safe). A
  // caller-supplied sbtTmpDir is reused as-is (the caller owns its lifetime);
  // otherwise one is allocated and cleaned up here, but only when there's an
  // sbt root to benefit from sharing it at all.
  let outcomes: RecursiveManifestOutcome[]
  try {
    outcomes = sbtTmpDir
      ? await runAll(sbtTmpDir)
      : candidatesByTool.get('sbt')?.length
        ? await withTmpDir('socket-sbt-facts-shared-', runAll)
        : await runAll(undefined)
  } finally {
    if (backupDir) {
      await fs.rm(backupDir, { recursive: true, force: true })
    }
  }

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
