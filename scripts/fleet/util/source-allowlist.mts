/**
 * @file Schema for cross-org publish allowlists used by infrastructure
 *   publishers (socket-addon, socket-bin). Each entry authorizes one
 *   (source-repo, build-workflow, tag-pattern) tuple to feed one (target-scope,
 *   name-prefix, triplet-set) family of npm tail packages. The allowlist is the
 *   trust boundary: an authorized source can mint binaries; an unauthorized
 *   source cannot. Adding a row is a PR review. This file declares only the
 *   SHAPE. Each consumer repo (socket-addon / socket-bin) ships its own
 *   `scripts/source-allowlist.mts` that imports `SourceAllowlistEntry` from
 *   here and exports an array of entries typed against it. The publish runner
 *   reads its repo's array and refuses to publish anything not matched by a
 *   row. Threat-model boundary: the allowlist DOES NOT verify that the bytes
 *   downloaded from a release are what the workflow signed. That's the job of
 *   GitHub's artifact-attestation API (`gh attestation verify
 *   --signer-workflow=…`). A row's `attestationSubject` field is the literal
 *   string to pass to that command. Allowlist + attestation are layered:
 *   allowlist answers "may I publish?", attestation answers "did the right
 *   workflow produce these bytes?". Both must hold. @see
 *   ./pack-app-triplets.mts for `PackAppTriplet`. @see Fleet plan
 *   `publishing-ultrathink-acorn-audit.md` for the topology.
 */

import type { PackAppTriplet } from './pack-app-triplets.mts'

/**
 * Npm scope authorized to publish binary tails. Limited to the two
 * fleet-infrastructure scopes — extending this union is a fleet-level decision
 * (new scope = new publisher repo = new trust boundary).
 */
export type SourceAllowlistTargetScope = '@socketaddon' | '@socketbin'

/**
 * Workflow path under a source repo's `.github/workflows/` directory. Encoded
 * as a template literal so a typo at compile time hurts.
 */
export type SourceAllowlistWorkflowPath =
  | `.github/workflows/${string}.yml`
  | `.github/workflows/${string}.yaml`

/**
 * GitHub `<owner>/<repo>` slug. Stricter than a bare string — at least one
 * slash, no leading / trailing slash.
 */
export type GitHubRepoSlug = `${string}/${string}`

/**
 * One authorized publish-tuple. Each row is independently revokable — delete it
 * and that family can no longer publish through this consumer.
 */
export interface SourceAllowlistEntry {
  /**
   * GitHub `<owner>/<repo>` of the authorized source. The repo whose
   * `releases/` the publisher reads from.
   */
  readonly sourceRepo: GitHubRepoSlug

  /**
   * Human label used in logs, audit trails, and PR descriptions. Should
   * uniquely identify the family within the consumer repo — `stuie-yoga`,
   * `ultrathink-acorn`, etc.
   */
  readonly familyId: string

  /**
   * Path inside `sourceRepo` to the build workflow authorized to produce
   * releases for this family. The publisher accepts releases only from this
   * workflow — releases manually created (via `gh release create`) or produced
   * by a different workflow are refused.
   */
  readonly workflowPath: SourceAllowlistWorkflowPath

  /**
   * Anchored regex matching the release-tag shape for this family. Must use
   * `^…$` anchors. Typical pattern: `^acorn-rust-\d+\.\d+\.\d+(-\S+)?$` for a
   * family that tags `acorn-rust-1.2.0` or `acorn-rust-1.2.0-alpha.0`.
   *
   * The pattern is the second authorization layer (after `workflowPath`): even
   * an authorized workflow can produce releases for other purposes (debug
   * builds, internal smoke runs); only releases whose tag matches this pattern
   * are eligible.
   */
  readonly tagPattern: RegExp

  /**
   * Npm scope this family publishes under. One of the fleet infrastructure
   * scopes.
   */
  readonly targetScope: SourceAllowlistTargetScope

  /**
   * Name prefix for every tail in this family. Tail name is
   * `${namePrefix}${triplet}`. Example: prefix `stuie-yoga-` → tail
   * `@socketaddon/stuie-yoga-darwin-arm64`.
   *
   * Convention: `<source-project>-<package>-` so the prefix carries both the
   * upstream project name and the package name. The trailing hyphen is REQUIRED
   * so the publisher can rely on `${prefix}${triplet}` concatenation.
   */
  readonly namePrefix: `${string}-`

  /**
   * Triplet set this family ships for. Subset of `PACK_APP_TRIPLETS`. Refusing
   * to publish a triplet not in this set defends against the source repo trying
   * to publish for unexpected platforms (e.g. a Linux-only family suddenly
   * shipping a Windows tail).
   */
  readonly triplets: readonly PackAppTriplet[]

  /**
   * Sigstore signer-subject expected on artifact attestations. Passed verbatim
   * to `gh attestation verify --signer-workflow=<this>`.
   *
   * Format:
   * `https://github.com/<owner>/<repo>/.github/workflows/<wf>@refs/tags/<pattern>`.
   * Derived from `sourceRepo` + `workflowPath` + the tag pattern, but
   * materialized explicitly so the verifier has a single comparison string and
   * any drift between the regex and the attestation surfaces as a review-time
   * mismatch, not a runtime surprise.
   */
  readonly attestationSubject: string

  /**
   * Optional maintainer label. Surfaces in publish audit logs and the fleet's
   * PR-review trail for changes to the allowlist. Free-form; typical value is a
   * GitHub handle or a team alias.
   */
  readonly maintainer?: string | undefined
}

/**
 * Build the canonical `attestationSubject` string for an allowlist row.
 * Centralized so every consumer derives the same shape — drift between "what
 * the verifier expects" and "what the build attests to" is the exact failure
 * mode this helper prevents.
 *
 * @example
 *   buildAttestationSubject({
 *     sourceRepo: 'SocketDev/ultrathink',
 *     workflowPath: '.github/workflows/build-rust.yml',
 *     tagGlob: 'acorn-rust-*',
 *   })
 *   // → 'https://github.com/SocketDev/ultrathink/.github/workflows/build-rust.yml@refs/tags/acorn-rust-*'
 */
export function buildAttestationSubject(input: {
  readonly sourceRepo: GitHubRepoSlug
  readonly workflowPath: SourceAllowlistWorkflowPath
  readonly tagGlob: string
}): string {
  return `https://github.com/${input.sourceRepo}/${input.workflowPath}@refs/tags/${input.tagGlob}`
}

/**
 * Look up the allowlist row that matches a `(sourceRepo, releaseTag)` pair.
 * Returns the entry if both `sourceRepo === entry.sourceRepo` and
 * `entry.tagPattern.test(releaseTag)`; returns `undefined` if no row matches.
 *
 * The publisher calls this at step 1 of every publish attempt. A `undefined`
 * return means "refuse the publish."
 *
 * If multiple rows match (same source repo + overlapping tag patterns), the
 * first match wins — author the allowlist so this never happens. A future lint
 * rule can sanity-check that no two rows in the same consumer could ever both
 * match the same tag.
 */
export function findAllowlistEntry(
  allowlist: readonly SourceAllowlistEntry[],
  sourceRepo: GitHubRepoSlug,
  releaseTag: string,
): SourceAllowlistEntry | undefined {
  for (let i = 0, { length } = allowlist; i < length; i += 1) {
    const entry = allowlist[i]!
    if (entry.sourceRepo === sourceRepo && entry.tagPattern.test(releaseTag)) {
      return entry
    }
  }
  return undefined
}

/**
 * Compute the full tail-package name for a `(entry, triplet)` pair. Pure
 * concatenation; centralized so callers can't misjoin the prefix.
 *
 * @example
 *   buildTailPackageName(entry, 'darwin-arm64')
 *   // → '@socketaddon/stuie-yoga-darwin-arm64'
 */
export function buildTailPackageName(
  entry: SourceAllowlistEntry,
  triplet: PackAppTriplet,
): string {
  return `${entry.targetScope}/${entry.namePrefix}${triplet}`
}

/**
 * Sentinel empty allowlist — useful for tests and for fresh-clone state where
 * the consumer hasn't yet declared any entries. Typed so an uninitialized
 * consumer can do `const ALLOWLIST: readonly SourceAllowlistEntry[] =
 * EMPTY_ALLOWLIST` without TypeScript complaining about widening.
 */
export const EMPTY_ALLOWLIST: readonly SourceAllowlistEntry[] = []
