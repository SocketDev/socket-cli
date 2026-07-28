/*
 * @file The sanctioned gap-fill backfill gate for the npm publish flow. A
 *   backfill republishes PRIOR content as a version that was skipped between
 *   two already-published versions — 1.4.3 between a live 1.4.2 and 1.4.4.
 *   The normal release path can't reach it: the bump/changelog gate anchors
 *   to registry latest and refuses anything at-or-below it, and a historical
 *   ref can't be dispatched because workflow_dispatch needs npm-publish.yml
 *   to exist on the dispatched ref. So the workflow is dispatched from MAIN
 *   with `checkout-ref` naming the CONTENT and `backfill-version` naming the
 *   gap, the bump stage is bypassed, and the staged publish runs behind five
 *   hard guards that keep the mode gap-fill-only:
 *
 *   1. The version must not be CURRENTLY published. The registry `time` map
 *      (the permanent publish ledger) plus the live `versions` set split the
 *      history three ways: never published (backfillable), published and
 *      still live (refused — nothing to fill), and published-then-UNPUBLISHED
 *      (backfillable — the staging-era registry frees an unpublished number,
 *      and the stage attempt is server-side rejectable, so the registry
 *      itself arbitrates). An unreadable ledger or versions set fails CLOSED.
 *   2. The version must be LOWER than registry latest. Backfill can only fill a
 *      gap behind history — it is never a way to skip the bump gate forward.
 *   3. The dist-tag must be explicitly non-`latest`. A backfill never moves the
 *      latest pointer.
 *   4. A checkout-ref is required — the workflow definition comes from main, so
 *      the content ref must be named, never implied.
 *   5. The package.json version at the checkout-ref must equal the backfill
 *      version — the content commit declares itself.
 */

import { lt } from '@socketsecurity/lib-stable/versions/compare'

import { logger, rootPath } from '../shared.mts'
import { fetchRegistryReleaseState } from './registry.mts'
import { resolveNpmWorkspaceLayout } from './workspace.mts'

// A release or prerelease semver. Guard 5 already pins the version to the
// checked-out manifest; this only rejects obvious non-versions early with a
// clearer message than a manifest mismatch.
const BACKFILL_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface BackfillGateInput {
  backfillVersion: string
  checkoutRef: string | undefined
  distTag: string | undefined
  /**
   * The registry `dist-tags.latest`, or undefined when the package has never
   * published — which refuses: with no latest there is no gap to fill.
   */
  latestVersion: string | undefined
  /**
   * The package.json version of the CHECKED-OUT content.
   */
  manifestVersion: string
  /**
   * The live registry `versions` set, or undefined when it could not be
   * read — which fails CLOSED alongside the time map.
   */
  publishedVersions: readonly string[] | undefined
  /**
   * The registry packument `time` map, or undefined when it could not be
   * read — which fails CLOSED: absence from the ledger can't be proven, so
   * the gate refuses.
   */
  timeMap: Record<string, string> | undefined
}

export type BackfillVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Evaluate the five backfill guards. Pure — the caller supplies the registry
 * state — so every guard is behaviorally testable without a network. Returns
 * the FIRST failing guard's reason; guards are ordered cheapest-first.
 */
export function evaluateBackfillGate(
  input: BackfillGateInput,
): BackfillVerdict {
  const cfg = { __proto__: null, ...input } as BackfillGateInput
  const {
    backfillVersion,
    checkoutRef,
    distTag,
    latestVersion,
    manifestVersion,
    publishedVersions,
    timeMap,
  } = cfg
  if (!BACKFILL_VERSION_RE.test(backfillVersion)) {
    return {
      ok: false,
      reason: `backfill-version "${backfillVersion}" is not a semver version.`,
    }
  }
  // Guard 4: the content ref must be named. The workflow definition comes
  // from main, so without an explicit checkout-ref the "content" would
  // silently be whatever main holds today.
  if (!checkoutRef) {
    return {
      ok: false,
      reason:
        'backfill requires checkout-ref — the branch/tag/SHA whose content ' +
        'is being republished. The workflow definition comes from main; the ' +
        'content ref is never implied.',
    }
  }
  // Guard 3: the latest pointer never moves on a backfill. The dist-tag
  // input defaults to `latest`, so an operator who didn't deliberately pick
  // a tag lands here.
  if (!distTag || distTag === 'latest') {
    return {
      ok: false,
      reason:
        'backfill requires an explicit non-`latest` dist-tag — a backfill ' +
        'never moves the latest pointer. Pick a tag like `backfill`.',
    }
  }
  // Guard 5: the content commit declares itself. The checked-out
  // package.json version must equal the backfill version, so the staged
  // tarball can only ever carry the version its own commit names.
  if (manifestVersion !== backfillVersion) {
    return {
      ok: false,
      reason:
        `the checked-out package.json says ${manifestVersion}, not ` +
        `${backfillVersion} — the content commit must declare the backfill ` +
        'version itself. Check out the commit whose package.json names it.',
    }
  }
  // Guard 2: gap-fill only, never forward. Anything at-or-above latest is
  // the bump gate's territory; a backfill that could move forward would be a
  // bump-gate bypass.
  if (!latestVersion) {
    return {
      ok: false,
      reason:
        'the registry has no latest version for this package — with nothing ' +
        'published there is no gap to backfill. Use the normal release path.',
    }
  }
  if (!lt(backfillVersion, latestVersion)) {
    return {
      ok: false,
      reason:
        `${backfillVersion} is not lower than the registry latest ` +
        `${latestVersion} — backfill fills gaps BEHIND history, never ahead ` +
        'of it. Use the normal bump/release path to move forward.',
    }
  }
  // Guard 1: not CURRENTLY published. The time map is the permanent ledger;
  // the live versions set says what is public NOW. Never-published passes; a
  // live version refuses (nothing to fill); published-then-UNPUBLISHED
  // passes — the staging-era registry frees an unpublished number, and the
  // stage attempt is server-side rejectable, so the registry itself is the
  // final arbiter. Unreadable state fails CLOSED.
  if (!timeMap || !publishedVersions) {
    return {
      ok: false,
      reason:
        "the registry ledger could not be read, so the version's publish " +
        'history is unverifiable — refusing rather than guessing. Retry ' +
        'when the registry is reachable.',
    }
  }
  if (publishedVersions.includes(backfillVersion)) {
    return {
      ok: false,
      reason:
        `${backfillVersion} is currently published — there is no gap to ` +
        'fill. Unpublish it first if the artifact is wrong, or pick a ' +
        'different version.',
    }
  }
  if (Object.hasOwn(timeMap, backfillVersion)) {
    logger.warn(
      `${backfillVersion} was published before and later unpublished — ` +
        'backfilling the freed number; the registry rejects the stage if ' +
        'it disagrees.',
    )
  }
  return { ok: true }
}

/**
 * The flag-composition conflicts around `--backfill`, checked before any
 * network call. Returns the conflict reason, or undefined when the flag set
 * is coherent. Pure, so the refusals are unit-testable.
 */
export function backfillFlagConflict(config: {
  backfillVersion: string | undefined
  bump: boolean
  checkoutRef: string | undefined
  mode: 'approve' | 'direct' | 'staged'
  releaseAs: string | undefined
}): string | undefined {
  const cfg = { __proto__: null, ...config } as {
    backfillVersion: string | undefined
    bump: boolean
    checkoutRef: string | undefined
    mode: 'approve' | 'direct' | 'staged'
    releaseAs: string | undefined
  }
  if (!cfg.backfillVersion) {
    return cfg.checkoutRef
      ? '--checkout-ref is only meaningful with --backfill.'
      : undefined
  }
  if (cfg.mode !== 'staged') {
    return '--backfill publishes through the staged path only — do not combine it with --approve/--direct.'
  }
  if (cfg.bump) {
    return '--backfill bypasses the bump/changelog gate — never combine it with --bump.'
  }
  if (cfg.releaseAs) {
    return '--backfill republishes prior content as-is — --release-as has no meaning here.'
  }
  return undefined
}

/**
 * Run the backfill gate against the live registry + the checked-out
 * package.json. Fetches latest + the time map in one packument read, then
 * defers to `evaluateBackfillGate`. Logs the verdict; returns false on any
 * refusal so the caller stops before staging.
 */
export async function runBackfillGate(config: {
  backfillVersion: string
  checkoutRef: string | undefined
  distTag: string | undefined
}): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as {
    backfillVersion: string
    checkoutRef: string | undefined
    distTag: string | undefined
  }
  // The publish SUBJECT, not the repo root: a multi-package workspace's
  // version source is the main member (a 0.0.0 root is a versionless
  // placeholder), so the gate must read the member's manifest and query the
  // member's packument.
  const subject = resolveNpmWorkspaceLayout(rootPath).versionSource
  const state = await fetchRegistryReleaseState(subject.name)
  const verdict = evaluateBackfillGate({
    backfillVersion: cfg.backfillVersion,
    checkoutRef: cfg.checkoutRef,
    distTag: cfg.distTag,
    latestVersion: state?.latest,
    manifestVersion: subject.version,
    publishedVersions: state?.versions,
    timeMap: state?.timeMap,
  })
  if (!verdict.ok) {
    logger.fail(
      `Backfill gate REFUSED ${subject.name}@${cfg.backfillVersion}.\n` +
        `  Why: ${verdict.reason}`,
    )
    return false
  }
  logger.log(
    `Backfill gate passed: ${subject.name}@${cfg.backfillVersion} is an ` +
      `unused gap below latest ${state!.latest}; staging under dist-tag ` +
      `"${cfg.distTag}".`,
  )
  return true
}
