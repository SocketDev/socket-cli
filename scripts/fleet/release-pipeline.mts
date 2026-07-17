/*
 * @file Claude-driveable staged-RELEASE pipeline orchestrator (release
 *   program #214). A "release" is a GitHub release — tag + immutable release
 *   artifact — and NEVER stages or publishes a package to a registry. Staging
 *   npm/cargo/python packages is the separate PUBLISH pipeline
 *   (publish-pipeline.mts), which resumes from this pipeline's shared state
 *   once the `release` stage has completed. Runs the release chain as EXPLICIT,
 *   RESUMABLE, RECEIPT-PRODUCING stages, each deferring to its owning script:
 *
 *   1. preflight — pnpm run update → pnpm i → fix --all → check --all
 *   2. exports — make-package-exports (opt-in) + public-files-are-exported
 *   3. files — pnpm pack tarball inspected via pack-contents-are-clean
 *   4. ci — surgical commit of staged fixes; green CI on a pushed head, or
 *      "local-only, CI deferred" (the pipeline NEVER pushes)
 *   5. bump-stop — HARD STOP: the USER names X.Y.Z (bump-defers-to-release-guard);
 *      `--version X.Y.Z` resumes
 *   6. bump — bump.mts writes CHANGELOG + the bump commit (LAST)
 *   7. release — tag vX.Y.Z + immutable GH release (ensureTagAndRelease)
 *
 *   Receipts live in a state file under
 *   node_modules/.cache/socket-release-pipeline/ (shared with publish-pipeline)
 *   — never the tracked tree — so a re-run resumes at the first missing/stale
 *   stage. `--dry-run` walks the stages without mutations (registry reads +
 *   tmp-dir packs allowed).
 *   Usage: node scripts/fleet/release-pipeline.mts [--dry-run] [--version
 *   X.Y.Z] [--status] [--reset] [--ci-timeout <seconds>]
 *   Then publish the cut version with: node scripts/fleet/publish-pipeline.mts
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { runCapture } from './publish-infra/shared.mts'
import {
  runCiGate,
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

import type { StageOutcome } from './release-pipeline/seams.mts'
import type { RunStageId, StageId } from './release-pipeline/stages.mts'
import type { PipelineState } from './release-pipeline/state.mts'

const logger = getDefaultLogger()

const USAGE = `Usage: node scripts/fleet/release-pipeline.mts [options]

  (no flags)             run/resume the readiness stages; stops at the bump
                         hard-stop until the USER names a version
  --version X.Y.Z        record the user-named version and resume through
                         bump + tag + immutable GH release
  --dry-run              walk stages without mutations (registry reads OK)
  --status               print the receipt table and exit
  --reset                discard pipeline state and exit
  --ci-timeout <seconds> CI poll budget for a pushed head (default 900)

  A "release" NEVER stages/publishes a package. Publish the cut version with:
  node scripts/fleet/publish-pipeline.mts`

export interface CliOptions {
  approve: boolean
  ciTimeoutMs: number
  distTag: string
  dryRun: boolean
  namedVersion: string | undefined
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
  options: { dryRun: boolean; key: string },
): PipelineState {
  const opts = { __proto__: null, ...options } as typeof options
  const next = recordReceipt(state, stage, {
    at: nowIso(),
    detail: outcome.detail,
    dryRun: opts.dryRun,
    key: opts.key,
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
      return await runPreflight({ cwd, dryRun })
    case 'exports':
      return await runExportsGate({ cwd, dryRun })
    case 'files':
      return await runFilesGate({ cwd, dryRun })
    case 'ci':
      return await runCiGate({ ciTimeoutMs, cwd, dryRun })
    case 'bump':
      return await runBumpStage({ cwd, dryRun, targetVersion })
    case 'release':
      return await runReleaseStage({ cwd, dryRun, targetVersion })
    case 'stage-publish':
      return await runStagePublish({ cwd, distTag, dryRun })
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
    const outcome = await runStage(stage, state, cli)
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
 * The separate explicit approve step (gated on a real verify receipt).
 */
export async function runApproveMode(
  state: PipelineState,
  cli: CliOptions,
): Promise<void> {
  const verify = state.stages['verify']
  if (!verify || verify.status !== 'passed' || verify.dryRun) {
    const saw = verify
      ? `verify ${verify.status}${verify.dryRun ? ' [dry-run]' : ''}`
      : 'no verify receipt'
    logger.fail(
      `No passing verify receipt — refusing to approve.\n` +
        `  Where: ${statePath(REPO_ROOT)}\n` +
        `  Saw ${saw}; wanted a real passed verify.\n` +
        `  Fix: run \`node scripts/fleet/release-pipeline.mts\` through the verify stage first ` +
        `(out-of-band staging can use \`node scripts/fleet/npm-publish.mts --approve\` directly — it re-verifies).`,
    )
    process.exitCode = 1
    return
  }
  const outcome = await runApproveStep({ cwd: REPO_ROOT, dryRun: cli.dryRun })
  persistOutcome(state, 'approve', outcome, {
    dryRun: cli.dryRun,
    key: state.targetVersion ?? '',
  })
  if (outcome.status === 'failed') {
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'ci-timeout': { default: '900', type: 'string' },
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
    logger.success(`Pipeline state cleared (${file}).`)
    return
  }
  const cli: CliOptions = {
    // Release never approves or stages a registry publish — those live in the
    // publish pipeline. The shared CliOptions carries the fields regardless.
    approve: false,
    ciTimeoutMs: Number.parseInt(String(values['ci-timeout']), 10) * 1000,
    distTag: 'latest',
    dryRun: !!values['dry-run'],
    namedVersion:
      typeof values['version'] === 'string' ? values['version'] : undefined,
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
