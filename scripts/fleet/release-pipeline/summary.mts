/**
 * @file Pure rendering for the release pipeline: the per-stage status table,
 *   the readiness summary printed at the bump HARD STOP (with the exact
 *   `--version X.Y.Z` resume instructions — the USER names the version, per
 *   bump-defers-to-release-guard), and the end-of-run receipt recap. No I/O;
 *   the CLI prints what these return.
 */

import { RUN_STAGE_ORDER, STAGE_DESCRIPTIONS } from './stages.mts'

import type { StageId } from './stages.mts'
import type { PipelineState, StageReceipt } from './state.mts'

const STATUS_MARKS: Readonly<Record<string, string>> = {
  deferred: '~',
  failed: 'x',
  passed: 'ok',
}

/**
 * One table line for a stage + its receipt (or pending marker).
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
  return `  [${mark}] ${name} ${receipt.detail}${dry} (${receipt.at})`
}

/**
 * Full status table over every run stage plus the approve receipt.
 */
export function renderStatus(state: PipelineState): string {
  const lines: string[] = [
    `Release pipeline for ${state.packageName} (started ${state.startedAt})`,
    state.targetVersion
      ? `Target version: ${state.targetVersion} (user-named)`
      : 'Target version: NOT NAMED YET (bump hard-stop pending)',
    '',
  ]
  for (const stage of RUN_STAGE_ORDER) {
    lines.push(renderStageLine(stage, state.stages[stage]))
  }
  lines.push(renderStageLine('approve', state.stages['approve']))
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
  options: { currentVersion: string },
): string {
  const opts = { __proto__: null, ...options } as typeof options
  return [
    renderStatus(state),
    '',
    'HARD STOP — awaiting the release version.',
    '',
    `Readiness gates are recorded above; current version is ${opts.currentVersion}.`,
    'The pipeline never picks a version. To continue, the USER names X.Y.Z:',
    '',
    '  node scripts/fleet/release-pipeline.mts --version X.Y.Z',
    '',
    'That resumes with: CHANGELOG + bump commit (bump.mts), tag vX.Y.Z +',
    'immutable GitHub release, then `pnpm stage publish` to npm staging.',
    'Promotion to public stays a separate explicit step afterwards:',
    '',
    '  node scripts/fleet/release-pipeline.mts --approve',
    '',
    '(Browser 2FA only — web-OTP; never pass a one-time code on the CLI.)',
  ].join('\n')
}

/**
 * End-of-run recap: what ran, what each receipt says, what comes next.
 */
export function renderRunRecap(
  state: PipelineState,
  options: { ranStages: readonly StageId[] },
): string {
  const opts = { __proto__: null, ...options } as typeof options
  const lines: string[] = ['Run complete. Receipts:']
  for (const stage of opts.ranStages) {
    lines.push(renderStageLine(stage, state.stages[stage]))
  }
  const verify = state.stages['verify']
  if (verify?.status === 'passed' && !verify.dryRun) {
    lines.push(
      '',
      'Staged + verified. Promote to public with the separate explicit step:',
      '  node scripts/fleet/release-pipeline.mts --approve',
    )
  }
  return lines.join('\n')
}
