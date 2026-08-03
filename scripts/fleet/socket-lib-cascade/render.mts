/**
 * @file The socket-lib cascade's human-facing RENDERERS: the per-stage status
 *   line, the full receipt table, the upstream-publish waiting banner, the USER
 *   release-gate banner, and the completion recap. Every function returns a
 *   string rather than logging, so the exact wording is asserted in tests.
 *   Backs `../socket-lib-cascade.mts`.
 */

import { CASCADE_STAGE_ORDER, CASCADE_STAGES, LIB_PKG } from './stages.mts'

import type { GateSpec, GateVerdict } from './gates.mts'
import type { CascadeStageId } from './stages.mts'
import type { CascadeState, ReceiptStatus, StageReceipt } from './state.mts'

export const STATUS_MARKS: Readonly<Record<ReceiptStatus, string>> = {
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
