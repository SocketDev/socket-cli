/**
 * @file The socket-lib cascade's I/O half: the registry read, the downstream
 *   activity read, the per-stage driver, receipt persistence, the graph-driven
 *   settle report, and the run/resume loop. Every decision routes through the
 *   pure helpers in `./gates.mts`, `./state.mts`, and `./render.mts`; the
 *   network, spawn, and filesystem edges live here. Each edge is an injected
 *   seam with a production default — `DriveIo` for the stage driver,
 *   `SettleConfig` for the settle report — so the whole run loop is unit-tested
 *   without a network, a spawn, or the operator's real `$PROJECTS` tree. Backs
 *   `../socket-lib-cascade.mts`.
 */

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { readObligation } from '../check/cascade-followups-are-settled.mts'
import {
  computeOwedFollowUps,
  flattenObligations,
  RELEASE_CASCADE_GRAPH,
  renderOwedAfterRelease,
} from '../lib/release-cascade.mts'
import { REPO_ROOT } from '../paths.mts'
import { fetchLatestPublishedVersionChecked } from '../publish-infra/npm/registry.mts'
import {
  catalogCommands,
  downstreamTriggerCommands,
  runDeferred,
  socketCliCommands,
} from './commands.mts'
import {
  classifyDownstreamActivity,
  publishedGateVerdict,
  resolveGateSpec,
} from './gates.mts'
import { renderComplete, renderUserGate, renderWaitingGate } from './render.mts'
import {
  CASCADE_STAGES,
  LIB_PKG,
  repoNeedsManifestRefresh,
  siblingRepoDir,
} from './stages.mts'
import {
  downstreamStatePath,
  planCascade,
  recordReceipt,
  saveState,
  statePath,
  summarizeDownstreamPipeline,
} from './state.mts'

import type { ObligationReading } from '../lib/release-cascade.mts'
import type { CommandSpec } from './commands.mts'
import type { RegistryReader } from './target.mts'
import type { CascadeStageId, CascadeStageSpec } from './stages.mts'
import type {
  CascadeState,
  DownstreamActivity,
  ReceiptStatus,
} from './state.mts'

const logger = getDefaultLogger()

export interface CliFlags {
  dryRun: boolean
  namedVersion: string | undefined
}

export interface StageOutcome {
  detail: string
  /**
   * True when the run must halt after this outcome — a gate wait, an in-flight
   * downstream, a user gate, or a failure. A passed outcome never halts.
   */
  halt: boolean
  status: ReceiptStatus
}

/**
 * The downstream release-pipeline read seam. Production:
 * `readDownstreamActivity`.
 */
export type DownstreamActivityReader = (
  repoDir: string,
) => DownstreamActivity | undefined

/**
 * The deferred-command seam — the shape of `runDeferred`, so a test asserts
 * WHICH commands a stage would run without spawning any of them.
 */
export type DeferredRunner = (
  commands: readonly CommandSpec[],
  config: { cwd: string; dryRun: boolean },
) => Promise<boolean>

/**
 * The downstream-declaration read seam. Production: `readObligation`.
 */
export type ObligationReader = (config: {
  edge: { kind: string; repo: string }
  pkg: string
  siblingsDir: string
}) => ObligationReading

export function nowIso(): string {
  return new Date().toISOString()
}

export function resolveProjectsDir(): string {
  return process.env['PROJECTS'] || path.join(os.homedir(), 'projects')
}

/**
 * A stage's working dir: the wheelhouse itself, or its sibling repo.
 */
export function stageRepoDir(
  spec: CascadeStageSpec,
  projectsDir: string = resolveProjectsDir(),
): string {
  return spec.repo === undefined
    ? REPO_ROOT
    : siblingRepoDir(projectsDir, spec.repo)
}

export async function readLatest(
  pkg: string,
): Promise<{ latest: string | undefined; reachable: boolean }> {
  const read = await fetchLatestPublishedVersionChecked(pkg)
  return {
    latest: read.reachable ? read.latest : undefined,
    reachable: read.reachable,
  }
}

/**
 * A downstream repo's release-pipeline activity, or undefined when unreadable.
 */
export function readDownstreamActivity(
  repoDir: string,
): DownstreamActivity | undefined {
  const file = downstreamStatePath(repoDir)
  if (!existsSync(file)) {
    return undefined
  }
  try {
    return summarizeDownstreamPipeline(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Every edge `driveStage` touches, bundled so one default parameter carries the
 * whole I/O surface. `projectsDir` is in the bundle rather than read from the
 * environment inside the driver: where the sibling repos live is an input to
 * the decision, not a hidden global.
 */
export interface DriveIo {
  projectsDir: string
  readActivity: DownstreamActivityReader
  readLatest: RegistryReader
  runCommands: DeferredRunner
}

/**
 * The production I/O bundle: real registry, real files, real spawns.
 */
export function defaultDriveIo(): DriveIo {
  return {
    projectsDir: resolveProjectsDir(),
    readActivity: readDownstreamActivity,
    readLatest,
    runCommands: runDeferred,
  }
}

/**
 * The deferred command sequence for a non-userGated stage, chosen EXPLICITLY
 * per stage. There is no fallback arm on purpose: a stage with no mapping is a
 * programming error, and inheriting another stage's sequence would run git
 * checkout/push inside the wrong repo. Throws rather than guessing.
 */
export function deterministicCommands(
  stageId: CascadeStageId,
  state: CascadeState,
): CommandSpec[] {
  if (stageId === 'wheelhouse-catalog') {
    const target = state.targetLibVersion
    if (target === undefined || target === '') {
      throw new Error(
        `cannot bump the ${LIB_PKG} catalog: the cascade target version is unset. ` +
          `Where: stage ${stageId}, cascade state file. ` +
          `Saw: targetLibVersion ${target === undefined ? 'undefined' : 'empty'}; ` +
          `wanted an already-published ${LIB_PKG} version. ` +
          'Fix: re-run with `--version X.Y.Z`, or `--reset` and let the ' +
          'registry latest resolve the target.',
      )
    }
    return catalogCommands(target)
  }
  if (stageId === 'socket-cli') {
    return socketCliCommands()
  }
  throw new Error(
    `no deterministic command sequence is mapped for stage ${stageId}. ` +
      'Where: deterministicCommands in scripts/fleet/socket-lib-cascade/drive.mts. ' +
      `Saw: a non-userGated stage ${stageId} reaching the deterministic arm; ` +
      'wanted a stage this function maps explicitly. ' +
      'Fix: add the stage to this mapping, or mark it userGated in ' +
      'socket-lib-cascade/stages.mts.',
  )
}

/**
 * Drive one stage: evaluate the pre-gate, then either run the deferred work
 * (non-userGated stages) or detect release progress and hand the user the gate
 * (userGated stages). All decision logic runs through the pure helpers above.
 */
export async function driveStage(
  stageId: CascadeStageId,
  state: CascadeState,
  cli: CliFlags,
  io: DriveIo = defaultDriveIo(),
): Promise<StageOutcome> {
  const spec = CASCADE_STAGES[stageId]
  const gate = resolveGateSpec(stageId, state)
  const gateRead = await io.readLatest(gate.pkg)
  const verdict = publishedGateVerdict({
    gate,
    reachable: gateRead.reachable,
    registryLatest: gateRead.latest,
  })
  if (verdict !== 'satisfied') {
    logger.log(
      renderWaitingGate({ gate, observed: gateRead.latest, stageId, verdict }),
    )
    return {
      detail:
        verdict === 'unreachable'
          ? `registry unreachable for ${gate.pkg}`
          : `waiting on ${gate.pkg} to publish`,
      halt: true,
      status: verdict === 'unreachable' ? 'blocked' : 'deferred',
    }
  }
  if (spec.userGated && spec.publishes !== undefined) {
    const repoDir = stageRepoDir(spec, io.projectsDir)
    const producedRead = await io.readLatest(spec.publishes)
    const activity = classifyDownstreamActivity({
      baselineVersion: state.baselineVersions[spec.publishes],
      pipeline: io.readActivity(repoDir),
      producedLatest: producedRead.latest,
      reachable: producedRead.reachable,
    })
    if (activity === 'released') {
      // What this release owes downstream comes straight from the cascade
      // graph, the same source release-pipeline prints after a cut.
      const owed = renderOwedAfterRelease(
        spec.publishes,
        producedRead.latest ?? '',
      )
      for (let i = 0, { length } = owed; i < length; i += 1) {
        logger.log(owed[i]!)
      }
      return {
        detail: `released ${spec.publishes}@${producedRead.latest}`,
        halt: false,
        status: 'passed',
      }
    }
    if (activity === 'in-flight') {
      logger.log(
        `IN-FLIGHT — a named ${spec.publishes} release is under way in ${repoDir}; ` +
          'not double-driving. Re-run once its release-pipeline completes.',
      )
      return {
        detail: `release in flight in ${spec.repo}; not double-driving`,
        halt: true,
        status: 'deferred',
      }
    }
    // `idle` runs the deterministic trigger once — `pnpm run update` +
    // release-pipeline to its bump-stop. `awaiting-version` means the trigger
    // already parked the repo at bump-stop, so re-running it would only churn
    // the downstream tree; skip straight to the user gate.
    if (activity === 'idle') {
      logger.log(`── stage: ${stageId} (trigger to bump-stop) ──`)
      const triggered = await io.runCommands(downstreamTriggerCommands(), {
        cwd: repoDir,
        dryRun: cli.dryRun,
      })
      if (!triggered) {
        return {
          detail: `release-pipeline trigger failed in ${spec.repo}`,
          halt: true,
          status: 'failed',
        }
      }
    } else {
      logger.log(
        `release-pipeline is already parked at bump-stop in ${repoDir}; ` +
          'awaiting the user-named version.',
      )
    }
    // The manifest-refresh step is a graph fact: does this repo owe a
    // registry-manifest-entry for the upstream it is absorbing?
    const needsManifestRefresh =
      spec.repo !== undefined &&
      repoNeedsManifestRefresh({ pkg: gate.pkg, repo: spec.repo })
    logger.log(
      renderUserGate({
        manifestPkg: gate.pkg,
        needsManifestRefresh,
        releasePkg: spec.publishes,
        repoDir,
        stageId,
      }),
    )
    return {
      detail: `triggered ${spec.repo} to bump-stop; awaiting the user-named ${spec.publishes} version`,
      halt: true,
      status: 'deferred',
    }
  }
  // Non-userGated deterministic stages: run the deferred owning scripts.
  const cwd = stageRepoDir(spec, io.projectsDir)
  const commands = deterministicCommands(stageId, state)
  logger.log(`── stage: ${stageId} ──`)
  const ok = await io.runCommands(commands, { cwd, dryRun: cli.dryRun })
  if (!ok) {
    return {
      detail: `deferred commands failed for ${stageId}`,
      halt: true,
      status: 'failed',
    }
  }
  return {
    detail:
      stageId === 'wheelhouse-catalog'
        ? `bumped the ${LIB_PKG} catalog to ${state.targetLibVersion} and landed`
        : 'refreshed and pushed the v1.x + main branches',
    halt: false,
    status: cli.dryRun ? 'deferred' : 'passed',
  }
}

/**
 * Persist one stage outcome to `stateFile`, log it, and return the next state.
 */
export function persistOutcome(
  state: CascadeState,
  stage: CascadeStageId,
  outcome: StageOutcome,
  config: { dryRun: boolean; ms: number; stateFile: string },
): CascadeState {
  const cfg = { __proto__: null, ...config } as typeof config
  const next = recordReceipt(state, stage, {
    at: nowIso(),
    detail: outcome.detail,
    dryRun: cfg.dryRun,
    key: state.targetLibVersion ?? '',
    ms: cfg.ms,
    status: outcome.status,
  })
  saveState(cfg.stateFile, next)
  if (outcome.status === 'passed') {
    logger.success(`[${stage}] ${outcome.detail}`)
  } else if (outcome.status === 'deferred') {
    logger.log(`[${stage}] ${outcome.detail}`)
  } else {
    logger.fail(`[${stage}] ${outcome.detail}`)
  }
  return next
}

/**
 * The reads the settle report stands on: registry truth per graph package and
 * each downstream repo's own declaration, plus where the sibling clones live.
 */
export interface SettleConfig {
  readLatest: RegistryReader
  readObligationFn: ObligationReader
  siblingsDir: string
}

export function defaultSettleConfig(): SettleConfig {
  return {
    readLatest,
    readObligationFn: readObligation,
    siblingsDir: resolveProjectsDir(),
  }
}

export interface SettleReportLine {
  level: 'success' | 'warn'
  text: string
}

/**
 * The graph-driven settle report as LINES: gather registry latests + downstream
 * declarations for every graph package and reuse computeOwedFollowUps to decide
 * what the cascade still owes. Same read the cascade-followups-are-settled
 * check runs, so the completion recap is an evidence verdict rather than a
 * prose pointer. Split from the logging so the wording is asserted directly.
 */
export async function settleReportLines(
  options: SettleConfig = defaultSettleConfig(),
): Promise<SettleReportLine[]> {
  const opts = { __proto__: null, ...options } as SettleConfig
  const packages = Object.keys(RELEASE_CASCADE_GRAPH)
  const latestByPackage: Record<string, string | undefined> = {}
  const readings: ObligationReading[] = []
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    latestByPackage[pkg] = (await opts.readLatest(pkg)).latest
    const edges = flattenObligations(pkg)
    for (let j = 0, { length: elen } = edges; j < elen; j += 1) {
      const edge = edges[j]!
      // follow-up-release edges carry no reading of their own; they derive
      // from their same-repo siblings inside computeOwedFollowUps.
      if (edge.kind === 'follow-up-release') {
        continue
      }
      readings.push(
        opts.readObligationFn({ edge, pkg, siblingsDir: opts.siblingsDir }),
      )
    }
  }
  const { owed } = computeOwedFollowUps({ latestByPackage, readings })
  if (!owed.length) {
    return [
      {
        level: 'success',
        text: 'cascade settled — no downstream declaration lags per release-cascade.mts.',
      },
    ]
  }
  const lines: SettleReportLine[] = [
    {
      level: 'warn',
      text: `${owed.length} downstream obligation(s) still owed per the cascade graph:`,
    },
  ]
  for (let i = 0, { length } = owed; i < length; i += 1) {
    const item = owed[i]!
    lines.push({
      level: 'warn',
      text: `  OWED [${item.edge.kind} ${item.edge.repo}] ${item.pkg}@${item.latest}: ${item.action}`,
    })
  }
  return lines
}

/**
 * Log the settle report.
 */
export async function reportSettle(
  options: SettleConfig = defaultSettleConfig(),
): Promise<void> {
  const lines = await settleReportLines(options)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.level === 'warn') {
      logger.warn(line.text)
    } else {
      logger.success(line.text)
    }
  }
}

/**
 * Everything the run loop writes to or reads from.
 */
export interface RunCascadeConfig {
  io: DriveIo
  settle: SettleConfig
  stateFile: string
}

export function defaultRunCascadeConfig(): RunCascadeConfig {
  return {
    io: defaultDriveIo(),
    settle: defaultSettleConfig(),
    stateFile: statePath(REPO_ROOT),
  }
}

/**
 * The run/resume loop: walk the plan, drive each stage, halt at the first gate
 * or failure. A passed stage advances; a deferred, blocked, or failed stage
 * stops the run and resumes there next time.
 */
export async function runCascade(
  initialState: CascadeState,
  cli: CliFlags,
  options: RunCascadeConfig = defaultRunCascadeConfig(),
): Promise<void> {
  const opts = { __proto__: null, ...options } as RunCascadeConfig
  let state = initialState
  const plan = planCascade(state)
  if (plan.satisfied.length) {
    logger.log(`Resuming: ${plan.satisfied.join(', ')} already complete.`)
  }
  if (plan.current === undefined) {
    logger.log(renderComplete(state))
    await reportSettle(opts.settle)
    return
  }
  for (const stage of plan.toRun) {
    const startMs = Date.now()
    const outcome = await driveStage(stage, state, cli, opts.io)
    state = persistOutcome(state, stage, outcome, {
      dryRun: cli.dryRun,
      ms: Date.now() - startMs,
      stateFile: opts.stateFile,
    })
    if (outcome.halt) {
      if (outcome.status === 'blocked' || outcome.status === 'failed') {
        process.exitCode = 1
      }
      return
    }
  }
  logger.log('')
  logger.log(renderComplete(state))
  await reportSettle(opts.settle)
}
