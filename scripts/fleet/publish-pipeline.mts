#!/usr/bin/env node
/*
 * @file PUBLISH pipeline — stage a bumped version's package(s) to a registry
 *   (npm / cargo / python), run the pre-approve verify gate, then promote via a
 *   separate explicit `--approve` (browser web-OTP 2FA) that — once the
 *   publish is confirmed live — continues into the release stage: the git tag
 *   + immutable GitHub release, cut LAST as the final marker.
 *
 *   This is the PUBLISH half of the release/publish split. The release
 *   pipeline (release-pipeline.mts) runs the readiness gates through the bump
 *   commit; this pipeline stages the bumped version, verifies it, and its
 *   `--approve` promotes + releases. The two share one state file, so publish
 *   resumes from the recorded target version + a passing `bump` receipt; it
 *   REFUSES when the bump hasn't landed (run the release pipeline first). The
 *   GATE INVERSION is deliberate: publishing never waits on a GitHub release —
 *   the release waits on the publish. The release stage REFUSES without a
 *   passed approve receipt AND without the version being resolvable on the
 *   registry (a STAGED package is not published; staging may never be
 *   approved — the v6.2.0 near-miss cut an immutable release whose publish
 *   then failed on auth). Private / github-release-only packages never run
 *   this pipeline at all.
 *
 *   Channel routing: this pipeline is the `npm-registry` engine (the stage →
 *   verify → approve model is npm's staged-publish flow). The other publish
 *   channels route to their OWN dedicated engines, NOT through here:
 *   `crates-registry` → cargo-publish.mts (its `--approve` is the actual
 *   `cargo publish`, then the same publish-before-release order: registry
 *   liveness, then tag + release), and `go-registry` → go-publish.mts
 *   (a Go module publishes by pushing a semver tag — no registry upload, no
 *   token, no stage/approve — so it has no analog to this flow; see
 *   go-publish.mts). The channel→workflow authority is `PUBLISH_WORKFLOW_BY_FROM`
 *   in sync-scaffolding/socket-wheelhouse-config.mts (`go-registry` →
 *   .github/workflows/go-publish.yml → the `go-publish` CI environment).
 *
 *   Stages: stage-publish (REMOTE-FIRST: dispatches + watches the
 *   npm-publish.yml workflow so the staged upload runs in CI under OIDC —
 *   nothing public yet; `--local` is the explicit offline escape into a
 *   local `pnpm stage publish`) → verify (pre-approve integrity gate;
 *   stashes the release-asset checksums) → approve (explicit, never part of
 *   a run) → release (same invocation as approve, cut LAST).
 *
 *   Usage: node scripts/fleet/publish-pipeline.mts [--dry-run] [--approve]
 *          [--status] [--reset] [--tag <dist-tag>] [--local]
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
import { planRun, PUBLISH_STAGE_ORDER } from './release-pipeline/stages.mts'
import {
  loadState,
  resetState,
  statePath,
  withReleaseChecksums,
} from './release-pipeline/state.mts'
import { renderRunRecap, renderStatus } from './release-pipeline/summary.mts'
import { isMainModule } from './_shared/is-main-module.mts'

import type { CliOptions } from './release-pipeline.mts'
import type { PipelineState } from './release-pipeline/state.mts'
import type { StageId } from './release-pipeline/stages.mts'

const logger = getDefaultLogger()

const USAGE = `Usage: node scripts/fleet/publish-pipeline.mts [options]

  (no flags)             stage-publish + verify the version the release
                         pipeline already bumped (refuses if none)
  --approve              SEPARATE explicit promote step (browser web-OTP 2FA);
                         on success the SAME invocation continues into the
                         release stage (tag + immutable GH release, cut LAST
                         behind a registry-liveness gate)
  --dry-run              walk stages without mutations (registry reads OK)
  --local                stage from THIS machine (npm-publish.mts --staged)
                         instead of dispatching the npm-publish.yml workflow;
                         only for genuinely offline use — the default keeps
                         registry credentials out of the local machine
  --status               print the receipt table and exit
  --reset                discard pipeline state and exit
  --tag <dist-tag>       npm dist-tag for the staged publish (default latest)`

/**
 * Publish requires a landed bump: a passing, non-dry-run `bump` receipt plus
 * the target version it landed at. The GATE INVERSION: publishing stands on
 * the bump, never on a GitHub release — the release is cut LAST, after the
 * publish is approved and live. Pure — exported for tests.
 */
export function bumpIsComplete(state: PipelineState): boolean {
  const receipt = state.stages['bump']
  return (
    !!receipt &&
    receipt.status === 'passed' &&
    !receipt.dryRun &&
    state.targetVersion !== undefined &&
    receipt.key === state.targetVersion
  )
}

/**
 * Run/resume the publish stages (stage-publish → verify) over the shared state.
 */
export async function runPublishPipeline(
  state: PipelineState,
  cli: CliOptions,
): Promise<void> {
  if (!bumpIsComplete(state)) {
    logger.fail(
      `publish-pipeline: no landed bump to publish.\n` +
        `  Where: ${statePath(REPO_ROOT)}\n` +
        `  Wanted: a passed \`bump\` receipt keyed at the target version.\n` +
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
    // Wall-time the stage: the receipt records how long it took so the
    // --status table names the long poles of the publish chain.
    const stageStartMs = Date.now()
    // eslint-disable-next-line no-await-in-loop -- stages are strictly sequential.
    const outcome = await runStage(stage, state_, cli)
    // A passing verify carries the release-asset checksums — stash them so
    // the post-approve release stage attaches the exact verified bytes.
    if (outcome.releaseChecksums) {
      state_ = withReleaseChecksums(state_, outcome.releaseChecksums)
    }
    // Publish stages key on the target version (the bumped version), never the
    // tree sha — the bump commit already moved HEAD by design.
    state_ = persistOutcome(state_, stage, outcome, {
      dryRun: cli.dryRun,
      key: state_.targetVersion ?? sha,
      ms: Date.now() - stageStartMs,
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
      local: { default: false, type: 'boolean' },
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
    // The publish pipeline never runs the ci/preflight stages — these two
    // exist only to satisfy the shared CliOptions shape.
    ciWait: false,
    distTag: String(values['tag']),
    dryRun: !!values['dry-run'],
    localPublish: !!values['local'],
    namedVersion: undefined,
    preflightAll: false,
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
