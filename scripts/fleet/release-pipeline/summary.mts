/**
 * @file Pure rendering for the release pipeline: the per-stage status table,
 *   the readiness summary printed at the bump HARD STOP (with the exact
 *   `--version X.Y.Z` resume instructions — the USER names the version, per
 *   bump-defers-to-release-guard), and the end-of-run receipt recap. No I/O;
 *   the CLI prints what these return.
 */

import { STAGE_DESCRIPTIONS, STATUS_STAGE_ORDER } from './stages.mts'

import type { StageId } from './stages.mts'
import type { PipelineState, StageReceipt } from './state.mts'

const STATUS_MARKS: Readonly<Record<string, string>> = {
  deferred: '~',
  failed: 'x',
  passed: 'ok',
}

/**
 * Human form of a stage's wall time: sub-second in ms, sub-minute in seconds,
 * minutes+seconds beyond — the release chain has a 2-minute budget, so the
 * table must make a 90s stage read as the long pole at a glance. Pure —
 * exported for tests.
 */
export function formatStageMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/**
 * One table line for a stage + its receipt (or pending marker). Receipts
 * written with a wall time render it so per-stage latency regressions are
 * visible straight from `--status`.
 */
export function renderStageLine(
  stage: StageId,
  receipt: StageReceipt | undefined,
): string {
  const name = stage.padEnd(13)
  if (!receipt) {
    return `  [ ] ${name} pending — ${STAGE_DESCRIPTIONS[stage]}`
  }
  const mark = (STATUS_MARKS[receipt.status] ?? '?').padEnd(2)
  const dry = receipt.dryRun ? ' [dry-run]' : ''
  const took =
    receipt.ms === undefined ? '' : `, took ${formatStageMs(receipt.ms)}`
  return `  [${mark}] ${name} ${receipt.detail}${dry} (${receipt.at}${took})`
}

/**
 * Full status table over every stage in canonical execution order —
 * readiness → bump → stage-publish → verify → approve → release (the release
 * is LAST: it only follows a confirmed, live registry publish).
 */
export function renderStatus(state: PipelineState): string {
  const lines: string[] = [
    `Release pipeline for ${state.packageName} (started ${state.startedAt})`,
    state.targetVersion
      ? `Target version: ${state.targetVersion} (user-named)`
      : 'Target version: NOT NAMED YET (bump hard-stop pending)',
    '',
  ]
  for (const stage of STATUS_STAGE_ORDER) {
    lines.push(renderStageLine(stage, state.stages[stage]))
  }
  return lines.join('\n')
}

/**
 * The bump hard-stop banner: readiness table + the resume instructions. The
 * pipeline NEVER chooses X.Y.Z — bump-defers-to-release-guard makes the
 * version a user decision, so the instructions address the user directly and
 * name the exact resume command.
 */
export function renderAwaitingVersion(
  state: PipelineState,
  config: { currentVersion: string },
): string {
  const cfg = { __proto__: null, ...config } as typeof config
  return [
    renderStatus(state),
    '',
    'HARD STOP — awaiting the release version.',
    '',
    `Readiness gates are recorded above; current version is ${cfg.currentVersion}.`,
    'The pipeline never picks a version. To continue, the USER names X.Y.Z:',
    '',
    '  node scripts/fleet/release-pipeline.mts --version X.Y.Z',
    '',
    'That resumes with the CHANGELOG + bump commit (bump.mts). Then stage +',
    'verify with `node scripts/fleet/publish-pipeline.mts`. Promotion to',
    'public stays a separate explicit step afterwards — and once the publish',
    'is live, the SAME invocation cuts the tag vX.Y.Z + immutable GitHub',
    'release LAST:',
    '',
    '  node scripts/fleet/publish-pipeline.mts --approve',
    '',
    '(Browser 2FA only — web-OTP; never pass a one-time code on the CLI.)',
  ].join('\n')
}

/**
 * End-of-run recap: what ran, what each receipt says, what comes next.
 */
export function renderRunRecap(
  state: PipelineState,
  config: { ranStages: readonly StageId[] },
): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const lines: string[] = ['Run complete. Receipts:']
  for (const stage of cfg.ranStages) {
    lines.push(renderStageLine(stage, state.stages[stage]))
  }
  const verify = state.stages['verify']
  if (verify?.status === 'passed' && !verify.dryRun) {
    lines.push(
      '',
      'Staged + verified. Promote to public with the separate explicit step',
      '(after a successful promote the same invocation cuts the tag +',
      'immutable GH release):',
      '  node scripts/fleet/publish-pipeline.mts --approve',
    )
  }
  return lines.join('\n')
}
