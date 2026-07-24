/*
 * @file Claude-driveable staged-RELEASE pipeline orchestrator (release
 *   program #214). This pipeline runs the READINESS chain through the bump
 *   commit; it NEVER stages/publishes a package and NEVER cuts the GitHub
 *   release. The tag + immutable GH release are the FINAL markers of a
 *   release — the publish pipeline (publish-pipeline.mts) cuts them LAST, in
 *   the same `--approve` invocation that confirms the registry publish
 *   (canonical order: readiness → bump-stop → bump → stage-publish → verify →
 *   approve → release). A STAGED package is not published — staging may never
 *   be approved — so a release cut earlier can mark a version that never
 *   shipped (the v6.2.0 near-miss). Runs the chain as EXPLICIT, RESUMABLE,
 *   RECEIPT-PRODUCING stages, each deferring to its owning script:
 *
 *   1. preflight — pnpm run update → pnpm i → fix --all → check --all
 *   2. cover — pnpm run cover + gen/coverage-badge refresh (the badge is a
 *      tracked asset the ci stage commits, so it rides ahead of the bump)
 *   3. exports — gen/package-exports (opt-in) + public-files-are-exported
 *   4. files — pnpm pack tarball inspected via pack-contents-are-clean
 *   5. ci — surgical commit of staged fixes; green CI on a pushed head, or
 *      "local-only, CI deferred" (the pipeline NEVER pushes)
 *   6. bump-stop — HARD STOP: the USER names X.Y.Z (bump-defers-to-release-guard);
 *      `--version X.Y.Z` resumes
 *   7. bump — bump.mts writes CHANGELOG + the bump commit (LAST commit)
 *
 *   Receipts live in a state file under
 *   node_modules/.cache/fleet/socket-release-pipeline/ (shared with publish-pipeline)
 *   — never the tracked tree — so a re-run resumes at the first missing/stale
 *   stage. `--dry-run` walks the stages without mutations (registry reads +
 *   tmp-dir packs allowed).
 *   Usage: node scripts/fleet/release-pipeline.mts [--dry-run] [--version
 *   X.Y.Z] [--status] [--reset] [--ci-timeout <seconds>]
 *   Then publish the bumped version with: node scripts/fleet/publish-pipeline.mts
 *   (stage-publish → verify), and promote + release with its `--approve`.
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { runCapture } from './publish-infra/shared.mts'
import {
  runCiGate,
  runCoverGate,
  runExportsGate,
  runFilesGate,
  runPreflight,
} from './release-pipeline/gate-runners.mts'
import {
  runApproveStep,
  runBumpStage,
  runReleaseStage,
  runStagePublish,
  runVerifyStage,
} from './release-pipeline/release-runners.mts'
import { readPkg } from './release-pipeline/seams.mts'
import {
  deriveReleaseLevel,
  isReceiptCurrent,
  localGatesGreenAt,
  planRun,
  restampTreeReceipts,
  stageKeyKind,
} from './release-pipeline/stages.mts'
import {
  loadState,
  newState,
  recordReceipt,
  resetState,
  saveState,
  statePath,
  withTargetVersion,
} from './release-pipeline/state.mts'
import {
  renderAwaitingVersion,
  renderRunRecap,
  renderStatus,
} from './release-pipeline/summary.mts'
import { isMainModule } from './_shared/is-main-module.mts'

import type { RunnerSeams, StageOutcome } from './release-pipeline/seams.mts'
import type { RunStageId, StageId } from './release-pipeline/stages.mts'
import type { PipelineState } from './release-pipeline/state.mts'

const logger = getDefaultLogger()

const USAGE = `Usage: node scripts/fleet/release-pipeline.mts [options]

  (no flags)             run/resume the readiness stages; stops at the bump
                         hard-stop until the USER names a version
  --version X.Y.Z        record the user-named version and resume through
                         the bump (CHANGELOG + bump commit)
  --dry-run              walk stages without mutations (registry reads OK)
  --status               print the receipt table (with per-stage wall time)
                         and exit
  --reset                discard pipeline state and exit
  --ci-timeout <seconds> CI poll budget for a pushed head (default 900)
  --ci-wait              block on the remote CI run even when every local
                         gate passed at this sha (default: record the ci
                         receipt as deferred-pending-remote and proceed;
                         the remote run stays an async back-check)
  --preflight-all        run the full-tree fix --all + check --all preflight
                         (default: changed-file scope)

  This pipeline NEVER stages/publishes a package or cuts the GH release.
  Publish the bumped version with: node scripts/fleet/publish-pipeline.mts
  (stage-publish → verify); its \`--approve\` promotes AND — once the publish
  is live — cuts the tag + immutable GH release in the same invocation.`

export interface CliOptions {
  approve: boolean
  ciTimeoutMs: number
  ciWait: boolean
  distTag: string
  dryRun: boolean
  // Publish pipeline --local: stage from this machine (npm-publish.mts
  // --staged) instead of the default dispatch-and-watch of npm-publish.yml.
  localPublish: boolean
  namedVersion: string | undefined
  preflightAll: boolean
}

/**
 * Current HEAD sha (full).
 */
export async function headSha(): Promise<string> {
  const r = await runCapture('git', ['rev-parse', 'HEAD'], REPO_ROOT)
  return r.stdout.trim()
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Write one stage outcome into state (+ disk) and log it.
 */
export function persistOutcome(
  state: PipelineState,
  stage: StageId,
  outcome: StageOutcome,
  config: { dryRun: boolean; key: string; ms?: number | undefined },
): PipelineState {
  const cfg = { __proto__: null, ...config } as typeof config
  const next = recordReceipt(state, stage, {
    at: nowIso(),
    detail: outcome.detail,
    dryRun: cfg.dryRun,
    key: cfg.key,
    ms: cfg.ms,
    status: outcome.status,
  })
  saveState(statePath(REPO_ROOT), next)
  if (outcome.status === 'failed') {
    logger.fail(`[${stage}] ${outcome.detail}`)
  } else {
    logger.success(`[${stage}] ${outcome.detail}`)
  }
  return next
}

/**
 * Dispatch one run stage to its runner.
 */
export async function runStage(
  stage: RunStageId,
  state: PipelineState,
  cli: CliOptions,
): Promise<StageOutcome> {
  const cwd = REPO_ROOT
  const { ciTimeoutMs, distTag, dryRun } = cli
  const targetVersion = state.targetVersion ?? ''
  switch (stage) {
    case 'preflight':
      return await runPreflight({ all: cli.preflightAll, cwd, dryRun })
    case 'cover':
      return await runCoverGate({ cwd, dryRun })
    case 'exports':
      return await runExportsGate({ cwd, dryRun })
    case 'files':
      return await runFilesGate({ cwd, dryRun })
    case 'ci':
      // The sanctioned non-blocking receipt: when every LOCAL gate passed at
      // this exact sha, the ci stage defers pending the remote run instead of
      // blocking on it (--ci-wait restores the strict blocking behavior).
      return await runCiGate({
        ciTimeoutMs,
        cwd,
        dryRun,
        localGatesGreen: localGatesGreenAt(state, await headSha()),
        waitForRemote: cli.ciWait,
      })
    case 'bump':
      return await runBumpStage({ cwd, dryRun, targetVersion })
    case 'release':
      // Never part of a planned run — only the post-approve continuation
      // reaches here (see runApproveMode). The runner itself re-checks the
      // approve receipt, so a miswired plan still refuses.
      return await runReleaseStage({
        approveReceipt: state.stages['approve'],
        cwd,
        dryRun,
        releaseChecksums: state.releaseChecksums,
        targetVersion,
      })
    case 'stage-publish':
      return await runStagePublish({
        cwd,
        distTag,
        dryRun,
        local: cli.localPublish,
      })
    case 'verify':
      return await runVerifyStage({ cwd, dryRun, targetVersion })
    default:
      return { detail: `no runner for stage ${stage}`, status: 'failed' }
  }
}

/**
 * The main run/resume loop.
 */
export async function runPipeline(
  initialState: PipelineState,
  cli: CliOptions,
): Promise<void> {
  let state = initialState
  const pkg = readPkg(REPO_ROOT)
  let sha = await headSha()
  const plan = planRun(state, { headSha: sha })
  if (plan.satisfied.length) {
    logger.log(
      `Resuming: ${plan.satisfied.join(', ')} already satisfied by current receipts.`,
    )
  }
  const ran: StageId[] = []
  for (const stage of plan.toRun) {
    logger.log(`── stage: ${stage} ──`)
    // Wall-time the stage: the receipt records how long it took so the
    // --status table names the long poles of the release chain.
    const stageStartMs = Date.now()
    const outcome = await runStage(stage, state, cli)
    const ms = Date.now() - stageStartMs
    // The ci stage may commit fixes, moving HEAD; re-read and re-key the
    // earlier tree receipts (the committed content is what they verified).
    if (stage === 'ci') {
      const newSha = await headSha()
      if (newSha !== sha) {
        state = restampTreeReceipts(state, newSha)
        sha = newSha
      }
    }
    const key =
      stageKeyKind(stage) === 'tree' ? sha : (state.targetVersion ?? sha)
    state = persistOutcome(state, stage, outcome, {
      dryRun: cli.dryRun,
      key,
      ms,
    })
    ran.push(stage)
    if (outcome.status === 'failed') {
      logger.fail(
        `Pipeline stopped at ${stage}. Fix the failure above and re-run — receipts resume the run here.`,
      )
      process.exitCode = 1
      return
    }
  }
  if (plan.awaitingVersion) {
    state = persistOutcome(
      state,
      'bump-stop',
      { detail: 'awaiting the user-named version', status: 'deferred' },
      { dryRun: cli.dryRun, key: sha },
    )
    logger.log('')
    logger.log(renderAwaitingVersion(state, { currentVersion: pkg.version }))
    return
  }
  logger.log('')
  logger.log(renderRunRecap(state, { ranStages: ran }))
}

/**
 * The separate explicit approve step (gated on a real verify receipt) — ONE
 * promote command. After a successful approve the SAME invocation continues
 * into the release stage, so the tag + immutable GH release follow the
 * confirmed registry publish without a second command. The release stage
 * itself refuses without a passed approve receipt and without registry
 * liveness (gate inversion: publish never waits on a release; the release
 * waits on the publish). `options.persist`/`options.seams` are injectable for
 * tests (defaults: persistOutcome + the real runner seams).
 */
export async function runApproveMode(
  state: PipelineState,
  cli: CliOptions,
  options?:
    | {
        persist?: typeof persistOutcome | undefined
        seams?: RunnerSeams | undefined
      }
    | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const persist = opts.persist ?? persistOutcome
  const verify = state.stages['verify']
  if (!verify || verify.status !== 'passed' || verify.dryRun) {
    const saw = verify
      ? `verify ${verify.status}${verify.dryRun ? ' [dry-run]' : ''}`
      : 'no verify receipt'
    logger.fail(
      `No passing verify receipt — refusing to approve.\n` +
        `  Where: ${statePath(REPO_ROOT)}\n` +
        `  Saw ${saw}; wanted a real passed verify.\n` +
        `  Fix: run \`node scripts/fleet/publish-pipeline.mts\` through the verify stage first ` +
        `(out-of-band staging can use \`node scripts/fleet/npm-publish.mts --approve\` directly — it re-verifies).`,
    )
    process.exitCode = 1
    return
  }
  let state_ = state
  const targetVersion = state_.targetVersion ?? ''
  const approveCurrent = isReceiptCurrent(state_.stages['approve'], {
    headSha: '',
    stage: 'approve',
    targetVersion: state_.targetVersion,
  })
  if (approveCurrent) {
    logger.log(
      'approve already satisfied by a current receipt — continuing into the release stage.',
    )
  } else {
    logger.log('── stage: approve ──')
    const approveStartMs = Date.now()
    const outcome = await runApproveStep({
      cwd: REPO_ROOT,
      dryRun: cli.dryRun,
      seams: opts.seams,
    })
    state_ = persist(state_, 'approve', outcome, {
      dryRun: cli.dryRun,
      key: targetVersion,
      ms: Date.now() - approveStartMs,
    })
    if (outcome.status === 'failed') {
      process.exitCode = 1
      return
    }
  }
  // Continue into the release stage: the tag + immutable GH release are cut
  // LAST, as the final marker behind the now-confirmed publish.
  if (
    isReceiptCurrent(state_.stages['release'], {
      headSha: '',
      stage: 'release',
      targetVersion: state_.targetVersion,
    })
  ) {
    logger.log('release already satisfied by a current receipt — done.')
    return
  }
  logger.log('── stage: release ──')
  const releaseStartMs = Date.now()
  const releaseOutcome = await runReleaseStage({
    approveReceipt: state_.stages['approve'],
    cwd: REPO_ROOT,
    dryRun: cli.dryRun,
    releaseChecksums: state_.releaseChecksums,
    seams: opts.seams,
    targetVersion,
  })
  persist(state_, 'release', releaseOutcome, {
    dryRun: cli.dryRun,
    key: targetVersion,
    ms: Date.now() - releaseStartMs,
  })
  if (releaseOutcome.status === 'failed') {
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'ci-timeout': { default: '900', type: 'string' },
      'ci-wait': { default: false, type: 'boolean' },
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      'preflight-all': { default: false, type: 'boolean' },
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
    logger.success(`Pipeline state cleared (${file}).`)
    return
  }
  const cli: CliOptions = {
    // Release never approves or stages a registry publish — those live in the
    // publish pipeline. The shared CliOptions carries the fields regardless.
    approve: false,
    ciTimeoutMs: Number.parseInt(String(values['ci-timeout']), 10) * 1000,
    ciWait: !!values['ci-wait'],
    distTag: 'latest',
    dryRun: !!values['dry-run'],
    localPublish: false,
    namedVersion:
      typeof values['version'] === 'string' ? values['version'] : undefined,
    preflightAll: !!values['preflight-all'],
  }
  if (!Number.isFinite(cli.ciTimeoutMs) || cli.ciTimeoutMs <= 0) {
    logger.fail('--ci-timeout must be a positive number of seconds.')
    process.exitCode = 1
    return
  }
  const pkg = readPkg(REPO_ROOT)
  let state = loadState(file)
  if (state && state.packageName !== pkg.name) {
    logger.warn(
      `State file is for ${state.packageName}, not ${pkg.name} — starting fresh.`,
    )
    state = undefined
  }
  state ??= newState(pkg.name, nowIso())
  if (values['status']) {
    logger.log(renderStatus(state))
    return
  }
  if (cli.namedVersion !== undefined) {
    // The version comes from the USER — the pipeline only validates that
    // bump.mts can land exactly there (or already has).
    if (pkg.version !== cli.namedVersion) {
      const derived = deriveReleaseLevel(pkg.version, cli.namedVersion)
      if (derived.error !== undefined) {
        logger.fail(derived.error)
        process.exitCode = 1
        return
      }
    }
    if (
      state.targetVersion !== undefined &&
      state.targetVersion !== cli.namedVersion
    ) {
      logger.warn(
        `Target version renamed: ${state.targetVersion} → ${cli.namedVersion}.`,
      )
    }
    state = withTargetVersion(state, cli.namedVersion)
    state = recordReceipt(state, 'bump-stop', {
      at: nowIso(),
      detail: `version ${cli.namedVersion} named by the user`,
      dryRun: false,
      key: cli.namedVersion,
      status: 'passed',
    })
    saveState(file, state)
  }
  await runPipeline(state, cli)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
