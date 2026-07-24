/**
 * @file Pure release-pipeline sequencing. Owns the stage order, the
 *   receipt-currency rules (tree stages key on the HEAD sha they passed at;
 *   release stages key on the user-named target version), the run plan
 *   (which stages still need to run, and the bump HARD STOP when no
 *   `--version` has been named), and the user-version → `--release-as` level
 *   derivation. Everything here is a pure function over plain data — the
 *   effectful runners live in runners.mts.
 */

import { computeNextVersion } from '../lib/changelog.mts'

import type { BumpLevel } from '../lib/changelog.mts'
import type { PipelineState, StageReceipt } from './state.mts'

/**
 * The RELEASE pipeline stages, in execution order — readiness gates through
 * the bump commit. The GH release is deliberately NOT here: the git tag + the
 * immutable GitHub release are the FINAL markers of a release, cut LAST by
 * the publish pipeline's `--approve` invocation only after the registry
 * publish is confirmed live. A STAGED package is not published — staging may
 * never be approved — so a release cut before approve can end up marking a
 * version that never shipped (the v6.2.0 near-miss).
 */
export const RELEASE_STAGE_ORDER = [
  'preflight',
  'cover',
  'exports',
  'files',
  'ci',
  'bump-stop',
  'bump',
] as const

/**
 * The PUBLISH pipeline run stages, in execution order — registry staging for
 * the version the RELEASE pipeline bumped. `approve` is deliberately NOT
 * here: promoting a staged package to public stays a separate, explicit
 * `--approve` invocation, never part of a `run`. The full publish order is
 * stage-publish → verify → approve → release: after a successful approve the
 * SAME invocation continues into the release stage, so one promote command
 * yields the tag + GH release behind the confirmed publish.
 */
export const PUBLISH_STAGE_ORDER = ['stage-publish', 'verify'] as const

/**
 * Both pipelines' run stages — the union used for shared receipt and
 * description typing (`StageId`, `STAGE_DESCRIPTIONS`, `PipelineState.stages`).
 * `release` is last: it is never part of a planned run (neither order lists
 * it) — it only runs as the post-approve continuation of `--approve`.
 */
export const RUN_STAGE_ORDER = [
  ...RELEASE_STAGE_ORDER,
  ...PUBLISH_STAGE_ORDER,
  'release',
] as const

export type RunStageId = (typeof RUN_STAGE_ORDER)[number]

export type StageId = RunStageId | 'approve'

/**
 * Every stage in canonical execution order, for `--status` rendering: the
 * readiness chain, then registry staging + verify, then the explicit approve,
 * then the release — cut LAST, after the publish is live.
 */
export const STATUS_STAGE_ORDER: readonly StageId[] = [
  ...RELEASE_STAGE_ORDER,
  ...PUBLISH_STAGE_ORDER,
  'approve',
  'release',
]

/**
 * Stages before the bump hard-stop: they gate the TREE, so their receipts key
 * on the HEAD sha they passed at.
 */
export const TREE_STAGES: readonly RunStageId[] = [
  'preflight',
  'cover',
  'exports',
  'files',
  'ci',
]

/**
 * What a stage's receipt is keyed on: tree stages on the HEAD sha (a moved
 * head re-runs them), release stages on the target version (the bump commit
 * moves HEAD by design, so a sha key would self-invalidate).
 */
export function stageKeyKind(stage: StageId): 'tree' | 'version' {
  return (TREE_STAGES as readonly string[]).includes(stage) ? 'tree' : 'version'
}

/**
 * The LOCAL gates the ci stage's non-blocking fast path requires: every tree
 * stage before ci. Exported for tests.
 */
export const LOCAL_GATES: readonly RunStageId[] = TREE_STAGES.filter(
  s => s !== 'ci',
)

/**
 * True when every local gate holds a REAL passed receipt keyed at `headSha` —
 * the precondition for the ci stage's sanctioned deferred-pending-remote fast
 * path. Deferred, failed, dry-run, or stale-sha receipts all disqualify: the
 * fast path only ever stands on gates that actually ran green on this exact
 * tree. Pure — exported for tests.
 */
export function localGatesGreenAt(
  state: PipelineState,
  headSha: string,
): boolean {
  for (let i = 0, { length } = LOCAL_GATES; i < length; i += 1) {
    const receipt = state.stages[LOCAL_GATES[i]!]
    if (
      !receipt ||
      receipt.dryRun ||
      receipt.status !== 'passed' ||
      receipt.key !== headSha
    ) {
      return false
    }
  }
  return true
}

/**
 * One-line purpose per stage, for the readiness summary.
 */
export const STAGE_DESCRIPTIONS: Readonly<Record<StageId, string>> = {
  approve:
    'pnpm stage approve (separate explicit --approve invocation; on success the same invocation continues into release)',
  bump: 'bump.mts: CHANGELOG + bump commit, from the user-named version',
  'bump-stop': 'HARD STOP — the USER names X.Y.Z; --version resumes',
  ci: 'commit staged fixes surgically; green CI on the pushed head, or defer (local gates green → pending-remote; --ci-wait blocks)',
  cover: 'pnpm run cover + gen/coverage-badge refresh (badge rides the bump)',
  exports: 'exports map ↔ public files agree (public-files-are-exported)',
  files: 'pnpm pack tarball inspected (pack-contents-are-clean)',
  preflight:
    'pnpm run update → pnpm i → fix → check (changed-file scope; --preflight-all for full-tree)',
  release:
    'git tag vX.Y.Z + immutable GH release (draft → upload → undraft), cut LAST — refuses without a passed approve + registry liveness',
  'stage-publish':
    'dispatch + watch npm-publish.yml (CI stages to npm under OIDC; nothing public yet; requires a bump receipt; --local stages from this machine)',
  verify:
    'pre-approve integrity gate (verifyStagedEntry vs staged shasum) + stash the release-asset checksums',
}

/**
 * Whether an existing receipt still satisfies a stage. A receipt counts only
 * when it PASSED (or deferred — the CI stage's sanctioned local-only outcome),
 * was not a dry run, and its currency key matches: HEAD sha for tree stages,
 * target version for release stages. Exception: a current bump receipt
 * supersedes tree-stage keys — the bump commit moved HEAD on purpose, and the
 * tree was green at bump time.
 */
export function isReceiptCurrent(
  receipt: StageReceipt | undefined,
  config: {
    headSha: string
    stage: StageId
    targetVersion: string | undefined
  },
): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!receipt || receipt.dryRun) {
    return false
  }
  if (receipt.status === 'failed') {
    return false
  }
  if (stageKeyKind(cfg.stage) === 'tree') {
    return receipt.key === cfg.headSha
  }
  return cfg.targetVersion !== undefined && receipt.key === cfg.targetVersion
}

export interface RunPlan {
  /**
   * True when the plan stops at the bump hard-stop: readiness stages are
   * planned/complete but no user-named version exists yet.
   */
  awaitingVersion: boolean
  /**
   * Stages already satisfied by a current receipt, in order.
   */
  satisfied: RunStageId[]
  /**
   * Stages that still need to run, in order.
   */
  toRun: RunStageId[]
}

/**
 * Compute the run plan: walk RUN_STAGE_ORDER, skip stages with a current
 * receipt, and stop at `bump-stop` when no target version has been named —
 * the bump hard-stop is a first-class pipeline state, not an error. A current
 * bump receipt supersedes stale tree-stage receipts (see isReceiptCurrent).
 */
export function planRun(
  state: PipelineState,
  config: { headSha: string; stageOrder?: readonly RunStageId[] | undefined },
): RunPlan {
  const cfg = { __proto__: null, ...config } as typeof config
  // Default to the RELEASE order; the publish pipeline passes PUBLISH_STAGE_ORDER.
  const stageOrder = cfg.stageOrder ?? RELEASE_STAGE_ORDER
  const { targetVersion } = state
  const bumpCurrent = isReceiptCurrent(state.stages['bump'], {
    headSha: cfg.headSha,
    stage: 'bump',
    targetVersion,
  })
  const satisfied: RunStageId[] = []
  const toRun: RunStageId[] = []
  for (const stage of stageOrder) {
    if (stage === 'bump-stop') {
      if (targetVersion === undefined) {
        return { awaitingVersion: true, satisfied, toRun }
      }
      continue
    }
    const treeSupersededByBump = bumpCurrent && stageKeyKind(stage) === 'tree'
    const current =
      treeSupersededByBump ||
      isReceiptCurrent(state.stages[stage], {
        headSha: cfg.headSha,
        stage,
        targetVersion,
      })
    if (current) {
      satisfied.push(stage)
    } else {
      toRun.push(stage)
    }
  }
  return { awaitingVersion: false, satisfied, toRun }
}

/**
 * Re-key existing tree-stage receipts onto a new HEAD sha. Used after the ci
 * stage surgically commits the fixes the earlier gates produced: the commit
 * moves HEAD, but the committed content IS what those gates saw, so their
 * receipts stay honest under the new sha. Pure — exported for tests.
 */
export function restampTreeReceipts(
  state: PipelineState,
  newHeadSha: string,
): PipelineState {
  const stages = { ...state.stages }
  for (let i = 0, { length } = TREE_STAGES; i < length; i += 1) {
    const stage = TREE_STAGES[i]!
    const receipt = stages[stage]
    if (receipt && receipt.status !== 'failed' && !receipt.dryRun) {
      stages[stage] = { ...receipt, key: newHeadSha }
    }
  }
  return { ...state, stages }
}

export type LevelDerivation =
  | { error: string; level?: undefined }
  | { error?: undefined; level: BumpLevel }

const SEMVER_RE = /^\d+\.\d+\.\d+$/

/**
 * Derive the `--release-as` level that makes bump.mts land EXACTLY on the
 * user-named target version. The pipeline never writes a version number
 * itself — bump.mts owns the write; this only names the level. A target that
 * is not one of the three exact increments of `current` is an error (the Fix
 * names the sanctioned alternatives, including the user-committed
 * `X.Y.Z-prerelease` hint bump.mts honors).
 */
export function deriveReleaseLevel(
  current: string,
  target: string,
): LevelDerivation {
  if (!SEMVER_RE.test(target)) {
    return {
      error:
        `--version must be a plain X.Y.Z semver (saw "${target}"). ` +
        `Prerelease/build suffixes are not releasable targets here.`,
    }
  }
  const levels: readonly BumpLevel[] = ['patch', 'minor', 'major']
  for (let i = 0, { length } = levels; i < length; i += 1) {
    const level = levels[i]!
    if (computeNextVersion(current, level) === target) {
      return { level }
    }
  }
  return {
    error:
      `--version ${target} is not a sequential bump of the current ` +
      `${current} (next: patch ${computeNextVersion(current, 'patch')}, ` +
      `minor ${computeNextVersion(current, 'minor')}, major ` +
      `${computeNextVersion(current, 'major')}). Fix: name one of those, or ` +
      `commit the hint version "${target}-prerelease" to package.json ` +
      `yourself (bump.mts consumes committed hints), then re-run.`,
  }
}
