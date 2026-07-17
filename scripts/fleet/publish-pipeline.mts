#!/usr/bin/env node
/*
 * @file PUBLISH pipeline — stage a released version's package(s) to a registry
 *   (npm / cargo / python), run the pre-approve verify gate, then promote via a
 *   separate explicit `--approve` (browser web-OTP 2FA).
 *
 *   This is the PUBLISH half of the release/publish split. A "release"
 *   (release-pipeline.mts) cuts an immutable GitHub release — tag + release
 *   artifact — and NEVER touches a package registry. "Publish" takes the
 *   version that release already cut and stages it. The two share one state
 *   file, so publish resumes from the release's recorded target version + a
 *   passing `release` receipt; it REFUSES when the release stage hasn't
 *   completed (run the release pipeline first). Private / github-release-only
 *   packages never run this pipeline at all.
 *
 *   Channel routing: this pipeline is the `npm-registry` engine (the stage →
 *   verify → approve model is npm's staged-publish flow). The other publish
 *   channels route to their OWN dedicated engines, NOT through here:
 *   `crates-registry` → cargo-publish.mts, and `go-registry` → go-publish.mts
 *   (a Go module publishes by pushing a semver tag — no registry upload, no
 *   token, no stage/approve — so it has no analog to this flow; see
 *   go-publish.mts). The channel→workflow authority is `PUBLISH_WORKFLOW_BY_FROM`
 *   in sync-scaffolding/socket-wheelhouse-config.mts (`go-registry` →
 *   .github/workflows/go-publish.yml → the `go-publish` CI environment).
 *
 *   Stages: stage-publish (pnpm stage publish — nothing public yet) → verify
 *   (pre-approve integrity gate). `--approve` is the separate promote step,
 *   never part of a run.
 *
 *   Usage: node scripts/fleet/publish-pipeline.mts [--dry-run] [--approve]
 *          [--status] [--reset] [--tag <dist-tag>]
 */
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import {
  headSha,
  persistOutcome,
  runApproveMode,
  runStage,
} from './release-pipeline.mts'
import { PUBLISH_STAGE_ORDER, planRun } from './release-pipeline/stages.mts'
import { loadState, resetState, statePath } from './release-pipeline/state.mts'
import { renderRunRecap, renderStatus } from './release-pipeline/summary.mts'
import { isMainModule } from './_shared/is-main-module.mts'

import type { CliOptions } from './release-pipeline.mts'
import type { PipelineState } from './release-pipeline/state.mts'
import type { StageId } from './release-pipeline/stages.mts'

const logger = getDefaultLogger()

const USAGE = `Usage: node scripts/fleet/publish-pipeline.mts [options]

  (no flags)             stage-publish + verify the version the release
                         pipeline already cut (refuses if none)
  --approve              SEPARATE explicit promote step (browser web-OTP 2FA)
  --dry-run              walk stages without mutations (registry reads OK)
  --status               print the receipt table and exit
  --reset                discard pipeline state and exit
  --tag <dist-tag>       npm dist-tag for the staged publish (default latest)`

/**
 * Publish requires a completed GitHub release: a passing, non-dry-run `release`
 * receipt plus the target version it was cut at. Pure — exported for tests.
 */
export function releaseIsComplete(state: PipelineState): boolean {
  const receipt = state.stages['release']
  return (
    !!receipt &&
    receipt.status === 'passed' &&
    !receipt.dryRun &&
    state.targetVersion !== undefined
  )
}

/**
 * Run/resume the publish stages (stage-publish → verify) over the shared state.
 */
export async function runPublishPipeline(
  state: PipelineState,
  cli: CliOptions,
): Promise<void> {
  if (!releaseIsComplete(state)) {
    logger.fail(
      `publish-pipeline: no completed GitHub release to publish.\n` +
        `  Where: ${statePath(REPO_ROOT)}\n` +
        `  Wanted: a passed \`release\` receipt + a target version.\n` +
        `  Fix: run \`node scripts/fleet/release-pipeline.mts --version X.Y.Z\` first, ` +
        `then re-run publish.`,
    )
    process.exitCode = 1
    return
  }
  let state_ = state
  const sha = await headSha()
  const plan = planRun(state_, {
    headSha: sha,
    stageOrder: PUBLISH_STAGE_ORDER,
  })
  if (plan.satisfied.length) {
    logger.log(
      `Resuming: ${plan.satisfied.join(', ')} already satisfied by current receipts.`,
    )
  }
  const ran: StageId[] = []
  for (const stage of plan.toRun) {
    logger.log(`── stage: ${stage} ──`)
    // eslint-disable-next-line no-await-in-loop -- stages are strictly sequential.
    const outcome = await runStage(stage, state_, cli)
    // Publish stages key on the target version (the released version), never the
    // tree sha — the bump commit already moved HEAD by design.
    state_ = persistOutcome(state_, stage, outcome, {
      dryRun: cli.dryRun,
      key: state_.targetVersion ?? sha,
    })
    ran.push(stage)
    if (outcome.status === 'failed') {
      logger.fail(
        `Publish stopped at ${stage}. Fix the failure above and re-run — receipts resume here.`,
      )
      process.exitCode = 1
      return
    }
  }
  logger.log('')
  logger.log(renderRunRecap(state_, { ranStages: ran }))
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      approve: { default: false, type: 'boolean' },
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      reset: { default: false, type: 'boolean' },
      status: { default: false, type: 'boolean' },
      tag: { default: 'latest', type: 'string' },
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
    approve: !!values['approve'],
    ciTimeoutMs: 0,
    distTag: String(values['tag']),
    dryRun: !!values['dry-run'],
    namedVersion: undefined,
  }
  const state = loadState(file)
  if (!state) {
    logger.fail(
      `publish-pipeline: no pipeline state at ${file}. Run the release ` +
        `pipeline first (it records the version to publish).`,
    )
    process.exitCode = 1
    return
  }
  if (values['status']) {
    logger.log(renderStatus(state))
    return
  }
  if (cli.approve) {
    await runApproveMode(state, cli)
    return
  }
  await runPublishPipeline(state, cli)
}

if (isMainModule(import.meta.url)) {
  void main()
}
