/**
 * @file The fleet's managed protection rulesets, one table entry each, keyed by
 *   the selector an operator tool takes on its command line. Every field is
 *   derived from the ONE check script that owns that ruleset's shape — its
 *   name, its GitHub target, the refs its canonical body covers, and the
 *   locator that finds it in a repo's ruleset list — so a tool that grants or
 *   revokes an exemption can never disagree with the script that maintains the
 *   ruleset. A third managed ruleset is one more entry here, not a second code
 *   path in every consumer.
 *   The canonical RULE TYPES are deliberately NOT part of an identity. The
 *   branch ruleset's rules vary with a repo's `squash-history` opt-in, and a
 *   tool that writes a ruleset back has to read the live rules anyway to carry
 *   them across, so the live ruleset — not a table — is the honest source for
 *   what a given repo currently enforces.
 */

import {
  MANAGED_RULESET_NAME as BRANCH_RULESET_NAME,
  parseManagedRulesetId as parseBranchRulesetId,
  rulesetPayload as branchRulesetPayload,
} from '../check/main-branch-rules-are-enforced.mts'
import {
  MANAGED_RULESET_NAME as TAG_RULESET_NAME,
  parseManagedRulesetId as parseTagRulesetId,
  rulesetPayload as tagRulesetPayload,
} from '../check/release-tags-are-immutable.mts'

/**
 * Which managed ruleset a tool acts on: the `branch` ruleset that blocks
 * force-push and deletion on the default branch, or the `tag` ruleset that
 * makes `v*` release tags immutable.
 */
export type ManagedRulesetSelector = 'branch' | 'tag'

/**
 * One managed ruleset's identity — everything a tool needs to name it, find it
 * in a repo's ruleset list, and point an operator at the script that owns it.
 */
export interface ManagedRulesetIdentity {
  /**
   * The command-line flag that selects this ruleset.
   */
  readonly flag: string
  /**
   * The list locator, reused from the owning check so the two always agree.
   */
  readonly findRulesetId: (json: string) => number | 'absent' | undefined
  /**
   * The ruleset name GitHub reports, and the name the owning check manages.
   */
  readonly name: string
  /**
   * The `--fix` invocation that creates and restores this ruleset.
   */
  readonly ownerScript: string
  /**
   * A junior-readable phrase for the refs this ruleset protects.
   */
  readonly protectedRefs: string
  /**
   * The ref patterns the canonical body includes.
   */
  readonly refInclude: readonly string[]
  /**
   * The selector that chooses this entry.
   */
  readonly selector: ManagedRulesetSelector
  /**
   * GitHub's ruleset target — `branch` or `tag`.
   */
  readonly target: string
}

// Only `target` and the ref includes are read off the canonical payload
// bodies; the rules a consumer needs come from the live ruleset it round-trips,
// so the branch payload's per-repo rule argument is immaterial here.
const BRANCH_PAYLOAD = branchRulesetPayload([])

const TAG_PAYLOAD = tagRulesetPayload()

const BRANCH_IDENTITY: ManagedRulesetIdentity = {
  findRulesetId: parseBranchRulesetId,
  flag: '--branch',
  name: BRANCH_RULESET_NAME,
  ownerScript:
    'node scripts/fleet/check/main-branch-rules-are-enforced.mts --fix',
  protectedRefs: 'the default branch',
  refInclude: BRANCH_PAYLOAD.conditions.ref_name.include,
  selector: 'branch',
  target: BRANCH_PAYLOAD.target,
}

const TAG_IDENTITY: ManagedRulesetIdentity = {
  findRulesetId: parseTagRulesetId,
  flag: '--tags',
  name: TAG_RULESET_NAME,
  ownerScript: 'node scripts/fleet/check/release-tags-are-immutable.mts --fix',
  protectedRefs: 'the v* release tags',
  refInclude: TAG_PAYLOAD.conditions.ref_name.include,
  selector: 'tag',
  target: TAG_PAYLOAD.target,
}

/**
 * The selector a tool uses when the operator names none. It stays `branch` so
 * every invocation written before a second ruleset existed keeps its meaning.
 */
export const DEFAULT_RULESET_SELECTOR: ManagedRulesetSelector = 'branch'

/**
 * Every managed ruleset. A consumer reads its flags and its identities from
 * this table instead of hardcoding a ruleset name.
 */
export const MANAGED_RULESET_IDENTITIES: readonly ManagedRulesetIdentity[] = [
  BRANCH_IDENTITY,
  TAG_IDENTITY,
]

/**
 * The identity a selector names. The selector type is a closed union and every
 * member has a table entry, so this always resolves.
 */
export function resolveManagedRulesetIdentity(
  selector: ManagedRulesetSelector,
): ManagedRulesetIdentity {
  return MANAGED_RULESET_IDENTITIES.find(e => e.selector === selector)!
}

/**
 * The identity a command-line flag names, or undefined when the flag is not a
 * ruleset selector — the caller reports it as an unrecognized flag.
 */
export function findRulesetIdentityByFlag(
  flag: string,
): ManagedRulesetIdentity | undefined {
  return MANAGED_RULESET_IDENTITIES.find(e => e.flag === flag)
}
