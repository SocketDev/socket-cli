/**
 * @file The STAGED CONTENT COMMIT: which commit the bytes a publish staged were
 *   actually built from. The release stage and the CI tag-gap healer both used
 *   to resolve a version's content commit indirectly, via findVersionFlipCommit
 *   (the commit where package.json flipped to that version). That inference is
 *   only true when nothing lands between the bump commit and the staging run —
 *   and on 2026-08-04 two releases (@socketsecurity/lib@6.5.3,
 *
 * @socketregistry/packageurl-js@1.5.1) staged from tips PAST their flip
 *   commits, so the healer compared the published bytes against the wrong tree,
 *   refused forever ("published contents DIVERGE"), and both tags had to be cut
 *   by hand at the true content commit.
 *
 *   The fix is to stop inferring: the stage-publish stage RECORDS the commit it
 *   staged from, and the consumers PREFER that record, falling back to the flip
 *   commit only when there is none (an older receipt, or a CI checkout with no
 *   pipeline state). Nothing here decides whether divergent bytes may ship —
 *   the byte-compare gates are untouched; this only decides WHICH commit those
 *   gates compare and which commit the tag lands on.
 *
 *   DEPENDENCY-FREE BY DESIGN: reconcile-gap.mts imports this on a bare
 *   depth-1 checkout with no `pnpm install`, so this module has no imports at
 *   all — plain string + JSON logic, unit-tested without fs, git, or network.
 */

/**
 * A full git commit sha, the only shape a recorded staged commit may take. An
 * abbreviated sha is rejected: the record is fed straight to `git tag <sha>`
 * and to byte-compare checkouts, where an ambiguous prefix is a wrong-commit
 * risk, not a formatting nit.
 */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/

/**
 * True when `value` is a full 40-hex commit sha. Pure.
 */
export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA_PATTERN.test(value)
}

/**
 * The receipt fields this module reads. Structural, not the `StageReceipt`
 * import — state.mts pulls fs + the mirror lock, which the dependency-free
 * reconcile-gap CLI cannot load.
 */
export interface StagedShaReceiptLike {
  dryRun?: boolean | undefined
  key?: string | undefined
  stagedSha?: string | undefined
  status?: string | undefined
}

/**
 * The staged content commit a receipt records, or undefined when the receipt
 * cannot license one. A record counts only when the stage actually PASSED for
 * real (a dry-run walk stages nothing) at THIS target version, and the sha is
 * a full commit sha — every other case falls back to the flip commit rather
 * than tagging a guess. Pure — exported for tests.
 */
export function stagedShaFromReceipt(
  receipt: StagedShaReceiptLike | undefined,
  config: { targetVersion: string },
): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  if (
    !receipt ||
    receipt.dryRun === true ||
    receipt.status !== 'passed' ||
    receipt.key !== cfg.targetVersion
  ) {
    return undefined
  }
  return isCommitSha(receipt.stagedSha) ? receipt.stagedSha : undefined
}

/**
 * The stage whose receipt carries the staged content commit. Named here so the
 * dependency-free readers below never have to import the StageId union.
 */
export const STAGED_SHA_STAGE = 'stage-publish'

/**
 * Repo-relative path of the pipeline state file, for readers that cannot
 * import state.mts (`statePath()` is the authority everywhere else).
 */
export const STATE_FILE_RELATIVE_PATH =
  '.cache/fleet/socket-release-pipeline/state.json'

/**
 * The staged content commit recorded in raw pipeline-state TEXT, or undefined
 * when the file is absent, unparseable, for another package, or carries no
 * usable record. Deliberately total: every failure is "no record", never a
 * throw — a missing or stale state file is the NORMAL case in CI, where the
 * healer runs on a fresh checkout and falls back to the flip commit. Pure —
 * exported for tests.
 */
export function stagedShaFromStateText(
  raw: string,
  config: { packageName?: string | undefined; targetVersion: string },
): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const state = parsed as {
    // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
    packageName?: unknown | undefined
    stages?: Record<string, unknown> | undefined
  }
  if (
    cfg.packageName !== undefined &&
    state.packageName !== undefined &&
    state.packageName !== cfg.packageName
  ) {
    return undefined
  }
  const stages = state.stages
  if (!stages || typeof stages !== 'object') {
    return undefined
  }
  const receipt = stages[STAGED_SHA_STAGE]
  if (!receipt || typeof receipt !== 'object') {
    return undefined
  }
  return stagedShaFromReceipt(receipt as StagedShaReceiptLike, {
    targetVersion: cfg.targetVersion,
  })
}
