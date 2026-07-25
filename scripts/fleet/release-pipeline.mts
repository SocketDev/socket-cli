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

import { appendFileSync } from 'node:fs'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { renderOwedAfterRelease } from './lib/release-cascade.mts'
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
  verifyAgainstRegistry,
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
  withReleaseChecksums,
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

// socket-lint: allow no-required-in-options-bag -- not an options bag: the
// parsed CLI flag set, always passed as the required positional `cli` param.
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
  if (outcome.status === 'blocked' || outcome.status === 'failed') {
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
    if (outcome.status === 'blocked' || outcome.status === 'failed') {
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
 * The separate explicit approve step (gated on a real verify receipt keyed
 * at the target version) — ONE promote command. After a successful approve
 * the SAME invocation continues into the release stage, so the tag +
 * immutable GH release follow the confirmed registry publish without a
 * second command. The release stage itself refuses without a passed approve
 * receipt and without registry liveness (gate inversion: publish never waits
 * on a release; the release waits on the publish). Missing/stale verify
 * receipts get ONE sanctioned recovery: when the target version is already
 * live on the registry, verify + approve receipts are minted from registry
 * truth (verifyAgainstRegistry — re-pack at the bump commit, compare against
 * the packument digests) and the invocation continues into the normal
 * release stage. `options.persist`/`options.seams` are injectable for tests
 * (defaults: persistOutcome + the real runner seams).
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
  let state_ = state
  const targetVersion = state_.targetVersion ?? ''
  const verify = state_.stages['verify']
  // Staging is one-shot per version, so verification must have completed
  // successfully — for THIS target version — before the human approve step is
  // offered. isReceiptCurrent enforces the key: a passed verify left over
  // from a previous release never licenses approving the next one.
  const verifyCurrent =
    verify?.status === 'passed' &&
    isReceiptCurrent(verify, {
      headSha: '',
      stage: 'verify',
      targetVersion: state_.targetVersion,
    })
  if (!verifyCurrent) {
    // REGISTRY-TRUTH RECONCILE: when the target version is ALREADY LIVE on
    // the registry (the publish happened but the pipeline receipts went
    // missing or false-negative — the 6.2.1 strand), mint the verify +
    // approve receipts from registry truth: re-pack at the bump commit and
    // compare against the packument dist digests (with the extracted-
    // contents fallback). Evidence, never a rubber stamp — divergent bytes
    // refuse, and a not-live version keeps the hard refusal below.
    const saw = verify
      ? `verify ${verify.status}${verify.dryRun ? ' [dry-run]' : ''} keyed at ${verify.key}`
      : 'no verify receipt'
    logger.log(
      `No current verify receipt (${saw}) — probing registry truth for ${targetVersion || '<no target version>'}…`,
    )
    const truth = targetVersion
      ? await verifyAgainstRegistry({
          cwd: REPO_ROOT,
          seams: opts.seams,
          targetVersion,
        })
      : undefined
    if (truth?.status === 'match') {
      logger.log('── registry-truth reconcile ──')
      state_ = withReleaseChecksums(state_, truth.releaseChecksums)
      state_ = persist(
        state_,
        'verify',
        {
          detail: `${truth.detail} [reconciled: version already live on the registry]`,
          releaseChecksums: truth.releaseChecksums,
          status: 'passed',
        },
        { dryRun: cli.dryRun, key: targetVersion },
      )
      state_ = persist(
        state_,
        'approve',
        {
          detail:
            `registry truth: ${state_.packageName}@${targetVersion} is already public — ` +
            `the promote happened out of band; receipt minted from the registry read, not a new approve`,
          status: 'passed',
        },
        { dryRun: cli.dryRun, key: targetVersion },
      )
    } else if (truth?.status === 'mismatch') {
      logger.fail(
        `Registry-truth reconcile REFUSED for ${targetVersion}.\n` +
          `  Where: ${truth.detail}\n` +
          `  Never mint verify/approve receipts over divergent or incomparable bytes.\n` +
          `  Fix: check out the exact bump commit for ${targetVersion} and re-run --approve.`,
      )
      process.exitCode = 1
      return
    } else {
      logger.fail(
        `No passing verify receipt for ${targetVersion || '<no target version>'} — refusing to approve.\n` +
          `  Where: ${statePath(REPO_ROOT)}\n` +
          `  Saw ${saw}; wanted a real passed verify keyed at the target version` +
          `${truth ? ` (and ${truth.detail} — nothing to reconcile from)` : ''}.\n` +
          `  Fix: run \`node scripts/fleet/publish-pipeline.mts\` through the verify stage first ` +
          `(out-of-band staging can use \`node scripts/fleet/npm-publish.mts --approve\` directly — it re-verifies).`,
      )
      process.exitCode = 1
      return
    }
  }
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
    return
  }
  // The release is cut — the cascade is not. Print what this release OWES
  // downstream from the release-cascade graph, so the operator leaves the
  // approve with the follow-up train named instead of remembered.
  for (const line of renderOwedAfterRelease(
    state_.packageName,
    targetVersion,
  )) {
    logger.log(line)
  }
}

/**
 * The tag-gap RECONCILE mode (`publish-pipeline.mts --reconcile X.Y.Z`): the
 * registry-truth verify + release stage ONLY, for a version that is ALREADY
 * LIVE on the registry but has no v* tag / GH release — the gap an npm-UI
 * owner promote leaves behind, since no local pipeline is running there.
 * Structurally narrower than runApproveMode: it can never stage, never
 * promote (runApproveStep is unreachable), never touches npm auth or an OTP.
 * The tree must be checked out at the version's content commit (package.json
 * reads the target version); verifyAgainstRegistry re-packs and compares
 * against the packument digests — divergent or incomparable bytes REFUSE, a
 * tag is never forced. On a match, verify + approve receipts are minted from
 * registry truth into a FRESH version-keyed state (never a resumed state
 * file: reconcile stands on registry evidence alone), then the normal release
 * stage cuts the tag + immutable GH release via ensureTagAndRelease behind
 * requireRegistryLive. `options.summaryPath` appends a job summary — the
 * workflow passes GITHUB_STEP_SUMMARY; unit tests omit it.
 */
export async function runReconcileMode(
  targetVersion: string,
  cli: CliOptions,
  options?:
    | {
        persist?: typeof persistOutcome | undefined
        seams?: RunnerSeams | undefined
        summaryPath?: string | undefined
      }
    | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const persist = opts.persist ?? persistOutcome
  const pkg = readPkg(REPO_ROOT)
  let state = withTargetVersion(newState(pkg.name, nowIso()), targetVersion)
  logger.log(
    `Reconcile: probing registry truth for ${pkg.name}@${targetVersion}…`,
  )
  const truth = await verifyAgainstRegistry({
    cwd: REPO_ROOT,
    seams: opts.seams,
    targetVersion,
  })
  if (truth.status !== 'match') {
    logger.fail(
      `Registry-truth reconcile REFUSED for ${pkg.name}@${targetVersion}.\n` +
        `  Where: ${truth.detail}\n` +
        (truth.status === 'not-live'
          ? `  A tag may only mark a LIVE registry version — nothing to reconcile.\n` +
            `  Fix: confirm the version is actually published, then re-run.`
          : `  Never tag divergent or incomparable bytes — the tag must mark the published content.\n` +
            `  Fix: check out the exact content commit for ${targetVersion} and re-run --reconcile.`),
    )
    process.exitCode = 1
    return
  }
  logger.log('── registry-truth reconcile ──')
  state = withReleaseChecksums(state, truth.releaseChecksums)
  state = persist(
    state,
    'verify',
    {
      detail: `${truth.detail} [reconciled: version already live on the registry]`,
      releaseChecksums: truth.releaseChecksums,
      status: 'passed',
    },
    { dryRun: cli.dryRun, key: targetVersion },
  )
  state = persist(
    state,
    'approve',
    {
      detail:
        `registry truth: ${pkg.name}@${targetVersion} is already public — ` +
        `the promote happened out of band; receipt minted from the registry read, not a new approve`,
      status: 'passed',
    },
    { dryRun: cli.dryRun, key: targetVersion },
  )
  logger.log('── stage: release ──')
  const releaseStartMs = Date.now()
  const releaseOutcome = await runReleaseStage({
    approveReceipt: state.stages['approve'],
    cwd: REPO_ROOT,
    dryRun: cli.dryRun,
    releaseChecksums: state.releaseChecksums,
    seams: opts.seams,
    targetVersion,
  })
  state = persist(state, 'release', releaseOutcome, {
    dryRun: cli.dryRun,
    key: targetVersion,
    ms: Date.now() - releaseStartMs,
  })
  if (releaseOutcome.status === 'failed') {
    process.exitCode = 1
    return
  }
  // The healed release owes the same downstream follow-ups a fresh one does —
  // print the release-cascade graph's owed list to the log and, in the
  // workflow, into the job summary the operator actually reads.
  const owedLines = renderOwedAfterRelease(pkg.name, targetVersion)
  for (const line of owedLines) {
    logger.log(line)
  }
  if (opts.summaryPath) {
    const sha = await headSha()
    appendFileSync(
      opts.summaryPath,
      `### release-reconcile: ${pkg.name}@${targetVersion}\n\n` +
        `- content commit: \`${sha}\`\n` +
        `- verify: ${truth.detail}\n` +
        `- checksums: sha1 \`${truth.releaseChecksums.sha1}\`, sha512-base64 \`${truth.releaseChecksums.sha512}\`\n` +
        `- release: ${releaseOutcome.detail}\n` +
        (owedLines.length
          ? `\n${owedLines
              .map(line =>
                line.startsWith('  - ')
                  ? `- ${line.slice(4)}`
                  : line.startsWith('  ')
                    ? `- ${line.slice(2)}`
                    : line,
              )
              .join('\n')}\n`
          : ''),
    )
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
