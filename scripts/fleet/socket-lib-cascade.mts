#!/usr/bin/env node
/*
 * @file Claude-driveable orchestrator for the socket-lib DOWNSTREAM RELEASE
 *   CASCADE. When `@socketsecurity/lib` publishes a new version, a fixed train
 *   of downstream repos must absorb it and re-release in strict order. This
 *   orchestrator SEQUENCES that train as explicit, resumable, receipt-producing
 *   stages — the same shape as release-pipeline.mts — but it NEVER hand-rolls a
 *   release and NEVER picks a version or approves a staged package. Those are
 *   USER GATES the orchestrator stops at; every release defers to the owning
 *   repo's own `release-pipeline.mts` + `publish-pipeline.mts`.
 *
 *   The cascade, in strict order — each downstream stage HARD-GATES on the
 *   upstream version being actually PUBLISHED on npm before it proceeds, since
 *   `pnpm run update` pulls the published version:
 *
 *   1. wheelhouse-catalog — bump the @socketsecurity/lib catalog pin to the
 *      target, reconcile the -stable alias, dogfood, `pnpm install
 *      --lockfile-only`, assert the catalog checks, land to wheelhouse main.
 *      The target is the ALREADY-PUBLISHED @socketsecurity/lib version, read
 *      from the registry or pinned with `--version`; this orchestrator never
 *      releases socket-lib itself.
 *   2. packageurl-js — `pnpm run update` then release @socketregistry/packageurl-js
 *      via its release-pipeline. STOPS at that repo's bump-stop where the USER
 *      names the version and at staged-approve where the USER approves in the
 *      npm web UI. Gates the next stage on packageurl-js publishing.
 *   3. socket-registry — update socket-lib + packageurl-js, refresh
 *      registry/manifest.json, release @socketsecurity/registry via its
 *      release-pipeline. USER version + staged approve. Gates next on the
 *      published registry version.
 *   4. socket-sdk-js — update socket-lib + packageurl-js, release
 *      @socketsecurity/sdk via its release-pipeline. USER version + staged
 *      approve. Gates next on the published sdk version.
 *   5. socket-cli — for BOTH the v1.x and main branches, `pnpm run update` to
 *      pull the new @socketsecurity/sdk, then push each branch. Push-only, no
 *      release, no user gate.
 *
 *   The downstream DEPENDENCY GRAPH is not redefined here: this driver consumes
 *   RELEASE_CASCADE_GRAPH from lib/release-cascade.mts — flattenObligations for
 *   the per-repo manifest obligation, renderOwedAfterRelease for what a landed
 *   release owes downstream, and computeOwedFollowUps for the settle verdict —
 *   and layers only the resumable release TRAIN on top: the strict stage order,
 *   the published-version gates, and the USER-gate stops.
 *
 *   Receipts live in a state file under
 *   .cache/fleet/socket-lib-cascade/ — never the tracked tree — so
 *   a re-run resumes at the first incomplete stage. It coordinates rather than
 *   races: when another session is mid-release on a downstream repo the
 *   orchestrator detects the in-flight state from that repo's release-pipeline
 *   receipts and does not double-drive. Pure stage-planning + published-version
 *   gate helpers are exported for tests; the spawn/registry edges are the thin
 *   CLI shell.
 *
 *   Usage: node scripts/fleet/socket-lib-cascade.mts [--version X.Y.Z]
 *     [--status] [--reset] [--dry-run]
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { readObligation } from './check/cascade-followups-are-settled.mts'
import {
  compareVersionsLoose,
  computeOwedFollowUps,
  flattenObligations,
  RELEASE_CASCADE_GRAPH,
  renderOwedAfterRelease,
} from './lib/release-cascade.mts'
import { REPO_ROOT } from './paths.mts'
import { fetchLatestPublishedVersionChecked } from './publish-infra/npm/registry.mts'
import { runInherit } from './publish-infra/shared.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { writeThroughMirrorLock } from './_shared/mirror-lock.mts'

import type { ObligationReading } from './lib/release-cascade.mts'

const logger = getDefaultLogger()

/**
 * The four fleet packages the cascade turns on — the socket-lib trigger and
 * the three downstream packages whose releases chain off it.
 */
export const LIB_PKG = '@socketsecurity/lib'
export const PURL_PKG = '@socketregistry/packageurl-js'
export const REGISTRY_PKG = '@socketsecurity/registry'
export const SDK_PKG = '@socketsecurity/sdk'

export type CascadeStageId =
  | 'wheelhouse-catalog'
  | 'packageurl-js'
  | 'socket-registry'
  | 'socket-sdk-js'
  | 'socket-cli'

/**
 * The cascade stages in strict execution order. A downstream stage never runs
 * before the stage above it has landed its published version.
 */
export const CASCADE_STAGE_ORDER: readonly CascadeStageId[] = [
  'wheelhouse-catalog',
  'packageurl-js',
  'socket-registry',
  'socket-sdk-js',
  'socket-cli',
]

/**
 * How a stage's pre-gate is measured. `fixed` — a named version must be live,
 * used for the entry gate on the target @socketsecurity/lib version. `advance`
 * — the package's registry latest must have moved past the baseline captured
 * at cascade start, the signal that the prior stage's release actually
 * published.
 */
export type GateMode = 'advance' | 'fixed'

interface StageGate {
  mode: GateMode
  pkg: string
}

export interface CascadeStageSpec {
  /**
   * The pre-gate this stage waits on before it may pull the upstream via
   * `pnpm run update`.
   */
  gate: StageGate
  /**
   * One-line purpose for the status table and banners.
   */
  description: string
  /**
   * The npm package this stage's release publishes, whose advance past the
   * baseline gates the NEXT stage. undefined for the catalog bump and the
   * push-only cli stage — neither publishes a package.
   */
  publishes: string | undefined
  /**
   * The sibling repo directory name under $PROJECTS, or undefined when the
   * stage runs in the wheelhouse itself.
   */
  repo: string | undefined
  /**
   * True when the stage defers to a repo's own release-pipeline, which stops at
   * the USER version gate and the web-UI staged approve. The orchestrator never
   * names a version or approves a package; it sequences and gates.
   */
  userGated: boolean
}

/**
 * The release TRAIN: the strict per-stage order, which repo each stage drives,
 * and which package its release publishes. This is the driver layer only — the
 * downstream obligation relationships live in RELEASE_CASCADE_GRAPH and are
 * consumed from there, never duplicated here.
 */
export const CASCADE_STAGES: Readonly<
  Record<CascadeStageId, CascadeStageSpec>
> = {
  'packageurl-js': {
    gate: { mode: 'fixed', pkg: LIB_PKG },
    description:
      'pnpm run update then release @socketregistry/packageurl-js via its release-pipeline — USER names the version, USER approves the staged package',
    publishes: PURL_PKG,
    repo: 'socket-packageurl-js',
    userGated: true,
  },
  'socket-cli': {
    gate: { mode: 'advance', pkg: SDK_PKG },
    description:
      'pnpm run update on the v1.x and main branches to pull the new @socketsecurity/sdk, then push each branch — no release',
    publishes: undefined,
    repo: 'socket-cli',
    userGated: false,
  },
  'socket-registry': {
    gate: { mode: 'advance', pkg: PURL_PKG },
    description:
      'update socket-lib + packageurl-js, refresh registry/manifest.json, release @socketsecurity/registry via its release-pipeline — USER version + staged approve',
    publishes: REGISTRY_PKG,
    repo: 'socket-registry',
    userGated: true,
  },
  'socket-sdk-js': {
    gate: { mode: 'advance', pkg: REGISTRY_PKG },
    description:
      'update socket-lib + packageurl-js, release @socketsecurity/sdk via its release-pipeline — USER version + staged approve',
    publishes: SDK_PKG,
    repo: 'socket-sdk-js',
    userGated: true,
  },
  'wheelhouse-catalog': {
    gate: { mode: 'fixed', pkg: LIB_PKG },
    description:
      'bump the @socketsecurity/lib catalog pin to the target, reconcile the -stable alias, dogfood, install --lockfile-only, assert catalog checks, land to wheelhouse main',
    publishes: undefined,
    repo: undefined,
    userGated: false,
  },
}

/**
 * The branches the push-only socket-cli stage refreshes and pushes, in order.
 */
export const SOCKET_CLI_BRANCHES: readonly string[] = ['v1.x', 'main']

export type ReceiptStatus = 'blocked' | 'deferred' | 'failed' | 'passed'

export interface StageReceipt {
  /**
   * ISO timestamp the receipt was written.
   */
  at: string
  /**
   * Human-readable evidence line — what the stage saw or did.
   */
  detail: string
  /**
   * True when written under --dry-run; a dry receipt never satisfies a real
   * run.
   */
  dryRun: boolean
  /**
   * Currency key — the target @socketsecurity/lib version this cascade drives.
   * A new socket-lib release changes the key and starts the cascade fresh.
   */
  key: string
  /**
   * Stage wall time in milliseconds. Absent on receipts written before the
   * field existed; rendering tolerates that.
   */
  ms?: number | undefined
  status: ReceiptStatus
}

export interface CascadeState {
  /**
   * Registry latest for each produced package at cascade start. A stage's
   * `advance` gate compares the current latest against its baseline here.
   */
  baselineVersions: Record<string, string>
  /**
   * Package name identity for the drift check on resume — always the socket-lib
   * package this orchestrator drives.
   */
  packageName: string
  stages: Partial<Record<CascadeStageId, StageReceipt>>
  /**
   * ISO timestamp of cascade creation.
   */
  startedAt: string
  /**
   * The ALREADY-PUBLISHED @socketsecurity/lib version this cascade absorbs.
   * Read from the registry or pinned with --version; never chosen here.
   */
  targetLibVersion: string | undefined
  /**
   * State-file schema version.
   */
  version: 1
}

export const STATE_DIR_NAME = 'socket-lib-cascade'
export const STATE_FILE_NAME = 'state.json'

// A downstream repo's own release-pipeline state lives under this cache segment;
// the orchestrator reads it to detect an in-flight release driven elsewhere.
const DOWNSTREAM_PIPELINE_DIR = 'socket-release-pipeline'

/**
 * Resolve the cascade state-file path for a repo root.
 */
export function statePath(repoRoot: string): string {
  return path.join(repoRoot, '.cache', 'fleet', STATE_DIR_NAME, STATE_FILE_NAME)
}

/**
 * The npm packages the cascade publishes, in stage order — the set whose
 * registry latest is snapshotted as the advance-gate baseline.
 */
export function producedPackages(): string[] {
  const out: string[] = []
  for (let i = 0, { length } = CASCADE_STAGE_ORDER; i < length; i += 1) {
    const { publishes } = CASCADE_STAGES[CASCADE_STAGE_ORDER[i]!]
    if (publishes !== undefined) {
      out.push(publishes)
    }
  }
  return out
}

/**
 * Fresh, empty cascade state.
 */
export function newState(startedAt: string): CascadeState {
  return {
    baselineVersions: {},
    packageName: LIB_PKG,
    stages: {},
    startedAt,
    targetLibVersion: undefined,
    version: 1,
  }
}

/**
 * Parse raw state-file text. Returns undefined on any shape mismatch so an
 * unreadable state file starts a fresh cascade instead of crashing it. Pure.
 */
export function parseState(raw: string): CascadeState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const s = parsed as Partial<CascadeState>
  if (
    s.version !== 1 ||
    typeof s.packageName !== 'string' ||
    typeof s.startedAt !== 'string' ||
    !s.stages ||
    typeof s.stages !== 'object' ||
    !s.baselineVersions ||
    typeof s.baselineVersions !== 'object'
  ) {
    return undefined
  }
  return {
    baselineVersions: s.baselineVersions,
    packageName: s.packageName,
    stages: s.stages,
    startedAt: s.startedAt,
    targetLibVersion:
      typeof s.targetLibVersion === 'string' ? s.targetLibVersion : undefined,
    version: 1,
  }
}

/**
 * Immutably record a stage receipt. Pure.
 */
export function recordReceipt(
  state: CascadeState,
  stage: CascadeStageId,
  receipt: StageReceipt,
): CascadeState {
  return { ...state, stages: { ...state.stages, [stage]: receipt } }
}

/**
 * Immutably set the target socket-lib version. Pure.
 */
export function withTargetLibVersion(
  state: CascadeState,
  targetLibVersion: string,
): CascadeState {
  return { ...state, targetLibVersion }
}

/**
 * Immutably stash the advance-gate baselines. Pure.
 */
export function withBaselineVersions(
  state: CascadeState,
  baselineVersions: Record<string, string>,
): CascadeState {
  return { ...state, baselineVersions }
}

/**
 * Load state from disk, or undefined when absent or unparseable.
 */
export function loadState(filePath: string): CascadeState | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }
  return parseState(readFileSync(filePath, 'utf8'))
}

/**
 * Persist state, creating the cache dir first.
 */
export function saveState(filePath: string, state: CascadeState): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeThroughMirrorLock(filePath, `${JSON.stringify(state, null, 2)}\n`)
}

/**
 * Clear the state file. Tolerates a missing file.
 */
export function resetState(filePath: string): void {
  safeDeleteSync(filePath)
}

/**
 * Whether a receipt marks its stage DONE for resume purposes: a real passed
 * receipt. A deferred, blocked, failed, or dry-run receipt never advances the
 * cascade. Pure.
 */
export function isStageComplete(receipt: StageReceipt | undefined): boolean {
  return receipt?.status === 'passed' && !receipt.dryRun
}

export interface CascadePlan {
  /**
   * The first incomplete stage — the one a run resumes at — or undefined when
   * every stage is complete.
   */
  current: CascadeStageId | undefined
  /**
   * Stages already satisfied by a real passed receipt, in order.
   */
  satisfied: CascadeStageId[]
  /**
   * Stages that still need to run, in order.
   */
  toRun: CascadeStageId[]
}

/**
 * Partition the stages into satisfied and still-to-run, in strict order. The
 * run loop walks `toRun` and halts at the first stage whose gate is not clear.
 * Pure.
 */
export function planCascade(state: CascadeState): CascadePlan {
  const satisfied: CascadeStageId[] = []
  const toRun: CascadeStageId[] = []
  for (let i = 0, { length } = CASCADE_STAGE_ORDER; i < length; i += 1) {
    const id = CASCADE_STAGE_ORDER[i]!
    if (isStageComplete(state.stages[id])) {
      satisfied.push(id)
    } else {
      toRun.push(id)
    }
  }
  return { current: toRun[0], satisfied, toRun }
}

export interface GateSpec {
  /**
   * The baseline latest for an `advance` gate — the stage clears once the
   * package's registry latest moves past this.
   */
  baselineVersion: string | undefined
  mode: GateMode
  pkg: string
  /**
   * The exact version a `fixed` gate requires to be live.
   */
  requiredVersion: string | undefined
}

/**
 * Resolve a stage's concrete pre-gate from its spec and the cascade state: a
 * `fixed` gate binds the target socket-lib version, an `advance` gate binds the
 * baseline captured for the gated package. Pure.
 */
export function resolveGateSpec(
  stageId: CascadeStageId,
  state: CascadeState,
): GateSpec {
  const { gate } = CASCADE_STAGES[stageId]
  if (gate.mode === 'fixed') {
    return {
      baselineVersion: undefined,
      mode: 'fixed',
      pkg: gate.pkg,
      requiredVersion: state.targetLibVersion,
    }
  }
  return {
    baselineVersion: state.baselineVersions[gate.pkg],
    mode: 'advance',
    pkg: gate.pkg,
    requiredVersion: undefined,
  }
}

export type GateVerdict = 'satisfied' | 'unreachable' | 'waiting'

/**
 * The published-version gate: whether the upstream a stage waits on is live.
 * `unreachable` — the registry could not be consulted, so the run retries
 * later. `waiting` — the required version or the advance past baseline has not
 * published yet. `satisfied` — the upstream is live and the stage may proceed.
 * Pure over the registry read so the gate is unit-tested without a network.
 */
export function publishedGateVerdict(config: {
  gate: GateSpec
  reachable: boolean
  registryLatest: string | undefined
}): GateVerdict {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.reachable) {
    return 'unreachable'
  }
  const { gate, registryLatest } = cfg
  if (registryLatest === undefined) {
    return 'waiting'
  }
  if (gate.mode === 'fixed') {
    if (gate.requiredVersion === undefined) {
      return 'waiting'
    }
    return compareVersionsLoose(registryLatest, gate.requiredVersion) >= 0
      ? 'satisfied'
      : 'waiting'
  }
  if (gate.baselineVersion === undefined) {
    return 'waiting'
  }
  return compareVersionsLoose(registryLatest, gate.baselineVersion) > 0
    ? 'satisfied'
    : 'waiting'
}

/**
 * The minimal read of a downstream repo's own release-pipeline state — enough
 * to tell whether a release is in flight there.
 */
export interface DownstreamActivity {
  releaseComplete: boolean
  targetVersion: string | undefined
}

/**
 * Summarize a downstream repo's release-pipeline `state.json` text: the named
 * target version and whether its release stage has passed. Returns undefined
 * when the text is absent or unparseable — no evidence of activity. Pure.
 */
export function summarizeDownstreamPipeline(
  raw: string,
): DownstreamActivity | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const s = parsed as {
    stages?:
      | { release?: { status?: unknown | undefined } | undefined }
      | undefined
    targetVersion?: unknown | undefined
  }
  return {
    releaseComplete: s.stages?.release?.status === 'passed',
    targetVersion:
      typeof s.targetVersion === 'string' ? s.targetVersion : undefined,
  }
}

export type DownstreamState =
  | 'awaiting-version'
  | 'idle'
  | 'in-flight'
  | 'released'

/**
 * Classify a userGated stage's downstream repo, so the orchestrator drives the
 * deterministic trigger exactly once and never races a session that is already
 * moving. `released` — the stage's published package has advanced past the
 * baseline, so its release is done and the cascade proceeds. `in-flight` — a
 * release is already under way there with a NAMED version, not yet cut, so the
 * orchestrator waits instead of double-driving. `awaiting-version` — the
 * repo's release-pipeline is already sitting at its bump-stop with no version
 * named yet, so the trigger has already run and only the USER version gate
 * remains; the orchestrator re-prints the gate but does NOT re-run the trigger,
 * which would churn the downstream tree. `idle` — nothing is moving, so this
 * run runs the trigger and then stops at the user version gate. Pure.
 */
export function classifyDownstreamActivity(config: {
  baselineVersion: string | undefined
  pipeline: DownstreamActivity | undefined
  producedLatest: string | undefined
  reachable: boolean
}): DownstreamState {
  const cfg = { __proto__: null, ...config } as typeof config
  if (
    cfg.reachable &&
    cfg.producedLatest !== undefined &&
    cfg.baselineVersion !== undefined &&
    compareVersionsLoose(cfg.producedLatest, cfg.baselineVersion) > 0
  ) {
    return 'released'
  }
  // A present, uncut pipeline means the trigger already ran there: named →
  // someone is mid-release; unnamed → it is parked at bump-stop for the user.
  if (cfg.pipeline !== undefined && !cfg.pipeline.releaseComplete) {
    return cfg.pipeline.targetVersion !== undefined
      ? 'in-flight'
      : 'awaiting-version'
  }
  return 'idle'
}

/**
 * The sibling repo directory for a repo name under a projects root. Pure.
 */
export function siblingRepoDir(projectsDir: string, repo: string): string {
  return path.join(projectsDir, repo)
}

/**
 * A downstream repo's release-pipeline state-file path. Pure.
 */
export function downstreamStatePath(repoDir: string): string {
  return path.join(
    repoDir,
    '.cache',
    'fleet',
    DOWNSTREAM_PIPELINE_DIR,
    STATE_FILE_NAME,
  )
}

/**
 * Whether the RELEASE_CASCADE_GRAPH declares that `repo` carries a
 * registry-manifest-entry obligation for `pkg` — the socket-registry
 * registry/manifest.json purl entry a stage must refresh when it absorbs the
 * upstream. Sourced from the graph via flattenObligations, never re-listed
 * here, so the driver reads the single dependency graph rather than duplicating
 * it. Pure.
 */
export function repoNeedsManifestRefresh(config: {
  pkg: string
  repo: string
}): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  const edges = flattenObligations(cfg.pkg)
  for (let i = 0, { length } = edges; i < length; i += 1) {
    const edge = edges[i]!
    if (edge.kind === 'registry-manifest-entry' && edge.repo === cfg.repo) {
      return true
    }
  }
  return false
}

const STATUS_MARKS: Readonly<Record<ReceiptStatus, string>> = {
  blocked: '!',
  deferred: '~',
  failed: 'x',
  passed: 'ok',
}

/**
 * One status-table line for a stage and its receipt, or a pending marker. Pure.
 */
export function renderStageLine(
  stage: CascadeStageId,
  receipt: StageReceipt | undefined,
): string {
  const name = stage.padEnd(18)
  if (!receipt) {
    return `  [ ] ${name} pending — ${CASCADE_STAGES[stage].description}`
  }
  const mark = (STATUS_MARKS[receipt.status] ?? '?').padEnd(2)
  const dry = receipt.dryRun ? ' [dry-run]' : ''
  const took =
    receipt.ms === undefined ? '' : `, took ${(receipt.ms / 1000).toFixed(1)}s`
  return `  [${mark}] ${name} ${receipt.detail}${dry} (${receipt.at}${took})`
}

/**
 * The full status table over every cascade stage in order. Pure.
 */
export function renderStatus(state: CascadeState): string {
  const lines: string[] = [
    `socket-lib downstream cascade (started ${state.startedAt})`,
    state.targetLibVersion
      ? `Target: ${LIB_PKG}@${state.targetLibVersion} (already published)`
      : `Target: NOT RESOLVED YET`,
    '',
  ]
  for (let i = 0, { length } = CASCADE_STAGE_ORDER; i < length; i += 1) {
    const id = CASCADE_STAGE_ORDER[i]!
    lines.push(renderStageLine(id, state.stages[id]))
  }
  return lines.join('\n')
}

/**
 * The banner for a stage blocked on an upstream publish: what it is waiting on
 * and what re-running does. Pure.
 */
export function renderWaitingGate(config: {
  gate: GateSpec
  observed: string | undefined
  stageId: CascadeStageId
  verdict: GateVerdict
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const { gate, observed, stageId, verdict } = cfg
  const wanted =
    gate.mode === 'fixed'
      ? `${gate.pkg}@${gate.requiredVersion ?? '<target not resolved>'} live`
      : `${gate.pkg} published past ${gate.baselineVersion ?? '<no baseline>'}`
  const saw =
    verdict === 'unreachable'
      ? 'the registry could not be consulted'
      : `registry latest is ${observed ?? 'unpublished'}`
  return [
    `WAITING — stage ${stageId} gates on ${wanted}.`,
    `  Saw: ${saw}.`,
    '  The next stage pulls the published version via `pnpm run update`, so it',
    '  cannot proceed until the upstream release is live on npm.',
    '  Re-run this orchestrator once it publishes; the cascade resumes here.',
  ].join('\n')
}

/**
 * The USER-gate banner for a downstream release stage. The orchestrator has
 * already run the deterministic trigger — `pnpm run update` + release-pipeline
 * to its bump-stop — so only the two genuine USER gates remain: naming the
 * downstream version, then approving the staged package in the npm web UI.
 * Pure.
 */
export function renderUserGate(config: {
  manifestPkg: string | undefined
  needsManifestRefresh: boolean
  releasePkg: string
  repoDir: string
  stageId: CascadeStageId
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const { manifestPkg, needsManifestRefresh, releasePkg, repoDir, stageId } =
    cfg
  const lines = [
    `USER GATE — stage ${stageId} releases ${releasePkg}.`,
    `  Repo: ${repoDir}`,
    '  The orchestrator already ran `pnpm run update` and triggered',
    '  release-pipeline to its bump-stop. Two USER steps remain:',
    '',
  ]
  let step = 1
  if (needsManifestRefresh) {
    lines.push(
      `  ${step}. Refresh registry/manifest.json so the ${manifestPkg ?? releasePkg} purl entry`,
      '     tracks the published version, then commit it.',
    )
    step += 1
  }
  lines.push(
    `  ${step}. Name the version at bump-stop — this resumes the bump commit:`,
    `       cd ${repoDir} && node scripts/fleet/release-pipeline.mts --version X.Y.Z`,
    `  ${step + 1}. Stage + verify, then approve the staged package in the npm web UI:`,
    '       node scripts/fleet/publish-pipeline.mts',
    '       node scripts/fleet/publish-pipeline.mts --approve',
    '  Browser 2FA only — web-OTP; never pass a one-time code on the CLI.',
    '',
    '  When the release publishes, re-run this orchestrator: it detects the',
    '  published version and gates the next stage on it.',
  )
  return lines.join('\n')
}

/**
 * The end-of-run recap when every stage is complete. Pure.
 */
export function renderComplete(state: CascadeState): string {
  return [
    `Cascade complete for ${LIB_PKG}@${state.targetLibVersion ?? '<unknown>'}.`,
    '  Every downstream stage absorbed the release and shipped in order.',
    '  Verify the train settled:',
    '    node scripts/fleet/check/cascade-followups-are-settled.mts',
  ].join('\n')
}

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

function nowIso(): string {
  return new Date().toISOString()
}

function resolveProjectsDir(): string {
  return process.env['PROJECTS'] || path.join(os.homedir(), 'projects')
}

/**
 * Resolve the working directory for a stage: the wheelhouse itself, or the
 * sibling repo under $PROJECTS.
 */
function stageRepoDir(spec: CascadeStageSpec): string {
  return spec.repo === undefined
    ? REPO_ROOT
    : siblingRepoDir(resolveProjectsDir(), spec.repo)
}

async function readLatest(
  pkg: string,
): Promise<{ latest: string | undefined; reachable: boolean }> {
  const read = await fetchLatestPublishedVersionChecked(pkg)
  return {
    latest: read.reachable ? read.latest : undefined,
    reachable: read.reachable,
  }
}

/**
 * Read a downstream repo's release-pipeline activity from disk, or undefined
 * when no state file is present.
 */
function readDownstreamActivity(
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
 * Run a sequence of deferred commands in a working directory, forwarding stdio.
 * Under --dry-run the commands are printed, not executed. Returns true when
 * every command exited zero.
 */
async function runDeferred(
  commands: ReadonlyArray<{ args: string[]; cmd: string }>,
  config: { cwd: string; dryRun: boolean },
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as typeof config
  for (const { args, cmd } of commands) {
    const line = `${cmd} ${args.join(' ')}`.trim()
    if (cfg.dryRun) {
      logger.log(`  [dry-run] would run (in ${cfg.cwd}): ${line}`)
      continue
    }
    logger.log(`  running (in ${cfg.cwd}): ${line}`)
    const code = await runInherit(cmd, args, cfg.cwd)
    if (code !== 0) {
      logger.fail(`  command failed with exit ${code}: ${line}`)
      return false
    }
  }
  return true
}

/**
 * The wheelhouse catalog stage's deferred command sequence, in order.
 */
function catalogCommands(
  targetVersion: string,
): Array<{ args: string[]; cmd: string }> {
  return [
    {
      args: [
        'scripts/repo/bump-catalog-tool.mts',
        `${LIB_PKG}@${targetVersion}`,
      ],
      cmd: 'node',
    },
    { args: ['scripts/fleet/fix.mts'], cmd: 'node' },
    { args: ['run', 'dogfood'], cmd: 'pnpm' },
    { args: ['install', '--lockfile-only'], cmd: 'pnpm' },
    {
      args: ['scripts/fleet/check/stable-aliases-match-base.mts'],
      cmd: 'node',
    },
    {
      args: ['scripts/fleet/check/baseline-catalog-deps-are-covered.mts'],
      cmd: 'node',
    },
    { args: ['scripts/fleet/land-work.mts', '--commit'], cmd: 'node' },
  ]
}

/**
 * The deterministic trigger the orchestrator runs in a downstream release repo:
 * absorb the published upstream, then run that repo's own release-pipeline
 * which HARD-STOPS at its bump-stop needing the repo's X.Y.Z. Naming that
 * version and approving the staged package stay USER gates; everything up to
 * bump-stop is automatic.
 */
function downstreamTriggerCommands(): Array<{ args: string[]; cmd: string }> {
  return [
    { args: ['run', 'update'], cmd: 'pnpm' },
    { args: ['scripts/fleet/release-pipeline.mts'], cmd: 'node' },
  ]
}

/**
 * The socket-cli push-only stage's deferred command sequence over both
 * branches, in order.
 */
function socketCliCommands(): Array<{ args: string[]; cmd: string }> {
  const out: Array<{ args: string[]; cmd: string }> = []
  for (let i = 0, { length } = SOCKET_CLI_BRANCHES; i < length; i += 1) {
    const branch = SOCKET_CLI_BRANCHES[i]!
    out.push(
      { args: ['fetch', 'origin'], cmd: 'git' },
      { args: ['checkout', branch], cmd: 'git' },
      { args: ['pull', '--ff-only', 'origin', branch], cmd: 'git' },
      { args: ['run', 'update'], cmd: 'pnpm' },
      { args: ['scripts/fleet/land-work.mts', '--commit'], cmd: 'node' },
      { args: ['push', 'origin', branch], cmd: 'git' },
    )
  }
  return out
}

/**
 * Drive one stage: evaluate the pre-gate, then either run the deferred work
 * (non-userGated stages) or detect release progress and hand the user the gate
 * (userGated stages). All decision logic runs through the pure helpers above.
 */
async function driveStage(
  stageId: CascadeStageId,
  state: CascadeState,
  cli: CliFlags,
): Promise<StageOutcome> {
  const spec = CASCADE_STAGES[stageId]
  const gate = resolveGateSpec(stageId, state)
  const gateRead = await readLatest(gate.pkg)
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
    const repoDir = stageRepoDir(spec)
    const producedRead = await readLatest(spec.publishes)
    const activity = classifyDownstreamActivity({
      baselineVersion: state.baselineVersions[spec.publishes],
      pipeline: readDownstreamActivity(repoDir),
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
      const triggered = await runDeferred(downstreamTriggerCommands(), {
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
  const cwd = stageRepoDir(spec)
  const commands =
    stageId === 'wheelhouse-catalog'
      ? catalogCommands(state.targetLibVersion ?? '')
      : socketCliCommands()
  logger.log(`── stage: ${stageId} ──`)
  const ok = await runDeferred(commands, { cwd, dryRun: cli.dryRun })
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
 * Persist one stage outcome, log it, and return the next state.
 */
function persistOutcome(
  state: CascadeState,
  stage: CascadeStageId,
  outcome: StageOutcome,
  config: { dryRun: boolean; ms: number },
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
  saveState(statePath(REPO_ROOT), next)
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
 * The graph-driven settle report: gather registry latests + downstream
 * declarations for every RELEASE_CASCADE_GRAPH package and reuse
 * computeOwedFollowUps to decide what the cascade still owes. This is the same
 * read the cascade-followups-are-settled check runs — reused in-process so the
 * completion recap is an evidence verdict, not a prose pointer.
 */
async function reportSettle(): Promise<void> {
  const packages = Object.keys(RELEASE_CASCADE_GRAPH)
  const siblingsDir = resolveProjectsDir()
  const latestByPackage: Record<string, string | undefined> = {}
  const readings: ObligationReading[] = []
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    latestByPackage[pkg] = (await readLatest(pkg)).latest
    const edges = flattenObligations(pkg)
    for (let j = 0, { length: elen } = edges; j < elen; j += 1) {
      const edge = edges[j]!
      if (edge.kind === 'follow-up-release') {
        continue
      }
      readings.push(readObligation({ edge, pkg, siblingsDir }))
    }
  }
  const { owed } = computeOwedFollowUps({ latestByPackage, readings })
  if (!owed.length) {
    logger.success(
      'cascade settled — no downstream declaration lags per release-cascade.mts.',
    )
    return
  }
  logger.warn(
    `${owed.length} downstream obligation(s) still owed per the cascade graph:`,
  )
  for (let i = 0, { length } = owed; i < length; i += 1) {
    const item = owed[i]!
    logger.warn(
      `  OWED [${item.edge.kind} ${item.edge.repo}] ${item.pkg}@${item.latest}: ${item.action}`,
    )
  }
}

/**
 * The run/resume loop: walk the plan, drive each stage, halt at the first gate
 * or failure. A passed stage advances; a deferred, blocked, or failed stage
 * stops the run and resumes there next time.
 */
async function runCascade(
  initialState: CascadeState,
  cli: CliFlags,
): Promise<void> {
  let state = initialState
  const plan = planCascade(state)
  if (plan.satisfied.length) {
    logger.log(`Resuming: ${plan.satisfied.join(', ')} already complete.`)
  }
  if (plan.current === undefined) {
    logger.log(renderComplete(state))
    await reportSettle()
    return
  }
  for (const stage of plan.toRun) {
    const startMs = Date.now()
    const outcome = await driveStage(stage, state, cli)
    state = persistOutcome(state, stage, outcome, {
      dryRun: cli.dryRun,
      ms: Date.now() - startMs,
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
  await reportSettle()
}

const USAGE = `Usage: node scripts/fleet/socket-lib-cascade.mts [options]

  (no flags)        run/resume the cascade; stop at the first upstream-publish
                    gate or downstream USER release gate
  --version X.Y.Z   pin the ALREADY-PUBLISHED @socketsecurity/lib target
                    (default: the registry latest). This never releases
                    socket-lib; it only names which published version cascades.
  --status          print the receipt table and exit
  --reset           discard cascade state and exit
  --dry-run         walk stages without mutations; registry reads still run
  --help            print this help and exit`

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      reset: { default: false, type: 'boolean' },
      status: { default: false, type: 'boolean' },
      version: { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  })
  if (values['help']) {
    logger.log(USAGE)
    return
  }
  const file = statePath(REPO_ROOT)
  if (values['reset']) {
    resetState(file)
    logger.success(`Cascade state cleared (${file}).`)
    return
  }
  const cli: CliFlags = {
    dryRun: !!values['dry-run'],
    namedVersion:
      typeof values['version'] === 'string' ? values['version'] : undefined,
  }
  // Resolve the target socket-lib version: the pinned one, else the registry
  // latest. The orchestrator reads an ALREADY-PUBLISHED version — it never
  // releases socket-lib.
  let target = cli.namedVersion
  if (target === undefined) {
    const libRead = await readLatest(LIB_PKG)
    if (!libRead.reachable) {
      logger.fail(
        `Could not read ${LIB_PKG} latest from the registry — re-run when it is reachable, or pin --version.`,
      )
      process.exitCode = 1
      return
    }
    if (libRead.latest === undefined) {
      logger.fail(`${LIB_PKG} has no published version — nothing to cascade.`)
      process.exitCode = 1
      return
    }
    target = libRead.latest
  }
  let state = loadState(file)
  if (
    state &&
    state.targetLibVersion !== undefined &&
    state.targetLibVersion !== target
  ) {
    logger.warn(
      `Target changed ${state.targetLibVersion} → ${target}; starting a fresh cascade.`,
    )
    state = undefined
  }
  if (!state) {
    // Capture the advance-gate baselines once, at cascade creation: each
    // produced package's registry latest before the cascade moves it.
    const baselines: Record<string, string> = {}
    for (const pkg of producedPackages()) {
      const read = await readLatest(pkg)
      if (read.latest !== undefined) {
        baselines[pkg] = read.latest
      }
    }
    state = withBaselineVersions(
      withTargetLibVersion(newState(nowIso()), target),
      baselines,
    )
    saveState(file, state)
  } else if (state.targetLibVersion === undefined) {
    state = withTargetLibVersion(state, target)
    saveState(file, state)
  }
  if (values['status']) {
    logger.log(renderStatus(state))
    return
  }
  logger.log(`Driving the ${LIB_PKG}@${target} downstream cascade.`)
  await runCascade(state, cli)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
