/**
 * @file The one canonical wording for a RELEASE GAP — a version that is public
 *   on its registry while its `v<version>` git tag and GitHub release are
 *   missing. Two surfaces share it so they can never drift: the publish tail
 *   (`publish-infra/release.mts`) shouts it the moment the tag/release leg
 *   fails, and the drift gate (`check/published-versions-have-releases.mts`)
 *   shouts it for a gap that already landed.
 *   The gap sits in the irreversible window: an npm publish cannot be undone,
 *   so the operator must leave with the exact healing command, never a hint.
 *   That command is `publish-pipeline.mts --reconcile X.Y.Z` — the stateless
 *   registry-truth healer, which re-packs at the content commit, compares
 *   against the packument digests, and only then cuts the tag + immutable
 *   release. Pure string building; no I/O, no logger, no deps.
 */

/**
 * The exact command that heals a release gap for `version`: the stateless
 * registry-truth reconcile. It never promotes anything (it cannot stage, cannot
 * approve, touches no npm auth or OTP) — it verifies the checked-out tree
 * against the published bytes and cuts the missing tag + GitHub release.
 */
export function releaseGapRecoveryCommand(version: string): string {
  return `node scripts/fleet/publish-pipeline.mts --reconcile ${version}`
}

/**
 * Why re-running the approve leg does NOT heal a release gap. `--approve`
 * filters out every staged entry whose name@version is already public BEFORE
 * it reaches the tag/release leg, so a second run reports "All staged entries
 * are already published; nothing to approve." and exits zero having cut
 * nothing. Naming this inline keeps an operator from burning a cycle on the
 * command that looks like the retry.
 */
export const APPROVE_IS_NOT_A_RESUME_PATH =
  're-running `--approve` does NOT heal this: the approve leg drops ' +
  'already-published versions before the tag/release step, so it exits ' +
  '"nothing to approve" without cutting a tag.'

/**
 * The four-part (What / Where / Saw vs. wanted / Fix) release-gap message.
 * `saw` states what was actually observed (a failed step, a missing tag);
 * `where` names the surface that observed it. The Fix line always carries the
 * literal reconcile command plus the note that `--approve` is not the retry.
 */
export function formatReleaseGapFailure(config: {
  name: string
  registry: string
  saw: string
  version: string
  where: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const tag = `v${cfg.version}`
  return [
    `  What:  ${cfg.name}@${cfg.version} is PUBLIC on ${cfg.registry}, but its ${tag} tag + GitHub release are missing.`,
    `         The registry write is irreversible — the release is half-done until the tag + release exist.`,
    `  Where: ${cfg.where}`,
    `  Saw:   ${cfg.saw}`,
    `         Wanted: a ${tag} tag on origin AND a published (undrafted) GitHub release for ${tag}.`,
    `  Fix:   ${releaseGapRecoveryCommand(cfg.version)}`,
    `         Run it from a checkout at the content commit for ${cfg.version};`,
    `         ${APPROVE_IS_NOT_A_RESUME_PATH}`,
  ].join('\n')
}
