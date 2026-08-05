/**
 * @file Every operator-facing line `grant-ruleset-bypass` prints: the status
 *   block, the usage block, and one builder per refusal. Each refusal carries
 *   What / Where / Saw vs. wanted / Fix in that order, and each names the
 *   SELECTED ruleset plus the one check script that owns its shape — so a
 *   `--tags` run never points an operator at the branch ruleset's owner.
 *   Pure and logger-free: a builder returns a string, the caller logs it,
 *   which is what lets the tests assert on exactly what an operator reads.
 */

import { FLEET_ROSTER_REL } from '../_shared/fleet-membership.mts'
import {
  DEFAULT_RULESET_SELECTOR,
  MANAGED_RULESET_IDENTITIES,
  resolveManagedRulesetIdentity,
} from '../_shared/managed-ruleset-identity.mts'
import type { ManagedRulesetIdentity } from '../_shared/managed-ruleset-identity.mts'
import { ruleTypesOfSnapshot, TOOL_NAME } from './ruleset-model.mts'
import type {
  BypassActor,
  FleetRepoTarget,
  RulesetSnapshot,
} from './ruleset-model.mts'

/**
 * Human-readable bypass-actor list for status output, or an explicit
 * "none" line naming the refs nobody can touch — an empty ruleset must never
 * render as blank, which reads as a failed query. Pure; exported for tests.
 */
export function formatBypassActors(
  actors: readonly BypassActor[],
  protectedRefs: string,
): string {
  if (actors.length === 0) {
    return `  (none — nobody can rewrite or delete ${protectedRefs})`
  }
  return actors
    .map(
      a => `  - ${a.actor_type} ${a.actor_id} (bypass_mode: ${a.bypass_mode})`,
    )
    .join('\n')
}

/**
 * The status block for one ruleset: what it is, what it enforces, and who may
 * bypass it. Built as one block so the indented actor list is a value the
 * logger prints, not decoration hand-rolled into a logger call. Pure; exported
 * for tests.
 */
export function statusReport(config: {
  readonly identity: ManagedRulesetIdentity
  readonly snapshot: RulesetSnapshot
  readonly target: FleetRepoTarget
}): string {
  const { identity, snapshot, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  return [
    `${TOOL_NAME}: ${target.owner}/${target.name} — ${identity.name} ` +
      `(${snapshot.target}, ${snapshot.enforcement}, rules: ` +
      `${ruleTypesOfSnapshot(snapshot).join(', ')})`,
    '  bypass actors:',
    formatBypassActors(snapshot.bypassActors, identity.protectedRefs),
  ].join('\n')
}

/**
 * The refusal for a missing fleet roster — membership, and therefore the repo
 * owner, is unresolvable without it. Pure; exported for tests.
 */
export function rosterMissingRefusal(rosterPath: string): string {
  return [
    `[${TOOL_NAME}] Refused: the fleet roster is missing.`,
    `  Where:  ${rosterPath}`,
    '  Saw:    no such file — membership is unresolvable.',
    '  Wanted: the canonical roster, present in the checkout.',
    '  Fix:    run this from a fleet checkout with the roster cascaded in.',
  ].join('\n')
}

/**
 * The refusal for a repo that is not on the fleet roster. Fleet tooling writes
 * only into roster members, and this tool writes a security-relevant setting,
 * so there is deliberately no `--allow-non-member` hatch: a non-member repo has
 * no managed ruleset for this tool to have an opinion about. Pure; exported for
 * tests.
 */
export function nonMemberRefusal(config: {
  readonly identity: ManagedRulesetIdentity
  readonly repoName: string
}): string {
  const { identity, repoName } = { __proto__: null, ...config } as typeof config
  return [
    `[${TOOL_NAME}] Refused: '${repoName}' is not a fleet-roster member.`,
    `  Where:  the canonical roster, ${FLEET_ROSTER_REL}`,
    `  Saw:    '${repoName}', which that roster does not list.`,
    '  Wanted: a bare roster repo name, e.g. socket-cli.',
    '  Fix:    check the spelling, or add the repo to the roster first.',
    `          This tool has no non-member escape hatch — a non-member has no`,
    `          ${identity.name} ruleset to exempt anyone from.`,
  ].join('\n')
}

/**
 * The refusal for `--grant` without `--yes`. Widening who may rewrite a
 * protected ref is never an accident of a half-typed command line. Pure;
 * exported for tests.
 */
export function grantNeedsYesRefusal(config: {
  readonly identity: ManagedRulesetIdentity
  readonly target: FleetRepoTarget
}): string {
  const { identity, target } = { __proto__: null, ...config } as typeof config
  return [
    `[${TOOL_NAME}] Refused: --grant needs --yes.`,
    `  Where:  ${target.owner}/${target.name} — ${identity.name}.`,
    '  Saw:    --grant with no confirmation flag.',
    '  Wanted: an explicit acknowledgement that this exempts you from the',
    `          protection rules on ${identity.protectedRefs}.`,
    '  Fix:    re-run with --yes, or drop --grant to just read the current',
    '          actors.',
  ].join('\n')
}

/**
 * The hard stop for a repo whose selected managed ruleset does not exist. This
 * tool never creates it: one script owns that ruleset's shape, and a second
 * creator would let the two definitions drift. Pure; exported for tests.
 */
export function absentRulesetRefusal(config: {
  readonly identity: ManagedRulesetIdentity
  readonly target: FleetRepoTarget
}): string {
  const { identity, target } = { __proto__: null, ...config } as typeof config
  return [
    `[${TOOL_NAME}] Refused: no ${identity.name} ruleset to grant against.`,
    `  Where:  ${target.owner}/${target.name} — repo-level rulesets.`,
    '  Saw:    the ruleset list is readable and carries no Repository-sourced',
    `          ruleset named ${identity.name}.`,
    '  Wanted: the canonical protection ruleset, already in place — target',
    `          ${identity.target}, refs ${identity.refInclude.join(', ')}.`,
    '  Fix:    create it with the one script that owns its shape —',
    `          ${identity.ownerScript}`,
    '          then re-run this tool. It is never created here.',
  ].join('\n')
}

/**
 * The hard stop for a ruleset whose live target disagrees with the selected
 * identity — a branch ruleset wearing the tag ruleset's name, or the reverse.
 * Writing it would report a tag exemption the operator never got. Pure;
 * exported for tests.
 */
export function targetMismatchRefusal(config: {
  readonly identity: ManagedRulesetIdentity
  readonly snapshot: RulesetSnapshot
  readonly target: FleetRepoTarget
}): string {
  const { identity, snapshot, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  return [
    `[${TOOL_NAME}] Failed: ${identity.name} does not target ${identity.target}.`,
    `  Where:  ${target.owner}/${target.name} — ruleset ${snapshot.id}.`,
    `  Saw:    target '${snapshot.target}' on a ruleset named ${identity.name}.`,
    `  Wanted: target '${identity.target}', the shape its owning script writes.`,
    '  Fix:    a foreign ruleset is wearing the managed name. Inspect it, then',
    `          converge the managed shape — ${identity.ownerScript}`,
    '          Nothing was changed.',
  ].join('\n')
}

/**
 * The loud failure for a rejected or unreadable `gh` call. Names the admin
 * scope explicitly: a token without repo-admin fails every ruleset write, and
 * reporting that as a generic hiccup is how an operator concludes the grant
 * landed. Pure; exported for tests.
 */
export function ghFailureRefusal(config: {
  readonly detail: string
  readonly identity: ManagedRulesetIdentity
  readonly target: FleetRepoTarget
  readonly what: string
}): string {
  const { detail, identity, target, what } = {
    __proto__: null,
    ...config,
  } as typeof config
  return [
    `[${TOOL_NAME}] Failed: ${what}.`,
    `  Where:  ${target.owner}/${target.name} — ${identity.name}.`,
    `  Saw:    ${detail || 'gh exited non-zero with no stderr.'}`,
    '  Wanted: a 200 from the GitHub rulesets API.',
    '  Fix:    ruleset reads and writes need repo-admin. Confirm with',
    `          gh api repos/${target.owner}/${target.name} --jq .permissions`,
    '          and re-authenticate if admin is false. Nothing was changed.',
  ].join('\n')
}

/**
 * The loud failure for a write that landed but lost protection rules — the
 * exact damage a hand-run full-body PUT causes. Pure; exported for tests.
 */
export function ruleDropRefusal(config: {
  readonly dropped: readonly string[]
  readonly identity: ManagedRulesetIdentity
  readonly target: FleetRepoTarget
}): string {
  const { dropped, identity, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  return [
    `[${TOOL_NAME}] Failed: the write DROPPED protection rules.`,
    `  Where:  ${target.owner}/${target.name} — ${identity.name}.`,
    `  Saw:    these rule types are gone after the write: ${dropped.join(', ')}.`,
    '  Wanted: an unchanged rule set, with only bypass_actors modified.',
    `  Fix:    restore the ruleset now — ${identity.ownerScript}`,
  ].join('\n')
}

/**
 * The expiry notice printed after every successful grant. A grant that reads
 * as durable is the failure mode this line exists to prevent. Pure; exported
 * for tests.
 */
export function expiryNotice(config: {
  readonly identity: ManagedRulesetIdentity
  readonly login: string
}): string {
  const { identity, login } = { __proto__: null, ...config } as typeof config
  return [
    '  This grant is TEMPORARY and self-expiring:',
    `    - ${identity.ownerScript}`,
    `      rewrites ${identity.name} to its canonical body, which carries no`,
    '      bypass_actors at all — that run revokes this grant.',
    `    - GitHub logs a "Bypassed rule violations" entry each time ${login} uses it.`,
    '  Revoke it yourself when done: re-run with --revoke.',
  ].join('\n')
}

/**
 * The usage block, shared by the arg-error paths. The ruleset flags are read
 * off the identity table, so a third managed ruleset advertises itself. Pure;
 * exported for tests.
 */
export function usageText(): string {
  const selectorLines = MANAGED_RULESET_IDENTITIES.map(
    identity =>
      `  ${identity.flag.padEnd(16)}Act on ${identity.name} — ${identity.protectedRefs}.`,
  )
  const defaultFlag = resolveManagedRulesetIdentity(
    DEFAULT_RULESET_SELECTOR,
  ).flag
  return [
    `Usage: node scripts/fleet/${TOOL_NAME}.mts <repo> [--grant --yes | --revoke] [ruleset]`,
    '',
    '  <repo>          A fleet-roster repo name, e.g. socket-cli.',
    "  (no action)     Read-only: list the ruleset's current bypass actors.",
    '  --grant --yes   Exempt the authenticated gh account from the selected',
    "                  ruleset's rules.",
    "  --revoke        Remove that same account's exemption.",
    ...selectorLines,
    '',
    `The ruleset defaults to ${defaultFlag} when no ruleset flag is given.`,
    'A grant applies to the authenticated account only — there is no --user',
    "flag. It is self-expiring: the selected ruleset's owning check --fix",
    'rewrites the ruleset without any bypass actors.',
  ].join('\n')
}
