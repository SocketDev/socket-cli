/**
 * @file The data model `grant-ruleset-bypass` round-trips: the shape of a
 *   GitHub ruleset as this tool holds it, the shape of a bypass actor, and the
 *   pure functions that parse, compare, and rebuild them. Everything here is
 *   side-effect free and network-free, so the whole read-modify-write contract
 *   is provable from fixtures.
 *   `conditions` and `rules` stay OPAQUE — parsed JSON carried across a write
 *   verbatim. Re-specifying either from a local model of what a ruleset
 *   "should" contain is exactly how a hand-run PUT silently drops a protection
 *   rule.
 */

import { parseFleetRepos } from '../check/member-ci-fires-on-push.mts'

/**
 * The tool name carried in every operator-facing message, so a line pasted
 * into a transcript names the script that produced it.
 */
export const TOOL_NAME = 'grant-ruleset-bypass'

/**
 * GitHub's bypass-actor kind this tool manages. Only `User` actors are ever
 * added or removed; a `Team`, `Integration`, or `OrganizationAdmin` actor
 * placed by someone else is reported by status and left untouched by writes.
 */
export const ACTOR_TYPE_USER = 'User'

/**
 * `always` rather than `pull_request` — the exemption exists for a direct
 * force-push or ref delete, which never travels through a PR.
 */
export const BYPASS_MODE_ALWAYS = 'always'

/**
 * One entry of a ruleset's `bypass_actors` array.
 */
export interface BypassActor {
  readonly actor_id: number
  readonly actor_type: string
  readonly bypass_mode: string
}

/**
 * The `RepositoryRole` bypass-actor kind, and GitHub's fixed id for the
 * Repository admin role within it (maintain = 2, write = 4, admin = 5).
 */
export const ACTOR_TYPE_REPOSITORY_ROLE = 'RepositoryRole'
export const REPOSITORY_ROLE_ADMIN_ID = 5

/**
 * The STANDING fleet bypass every managed ruleset carries: Repository admin,
 * always allowed. Unlike the temporary per-user grants this tool manages, the
 * admin-role exemption is part of the canonical ruleset shape — an admin
 * locked out of the repo they administer has no sanctioned path to fix the
 * lockout itself.
 */
export const REPOSITORY_ADMIN_BYPASS: BypassActor = {
  actor_id: REPOSITORY_ROLE_ADMIN_ID,
  actor_type: ACTOR_TYPE_REPOSITORY_ROLE,
  bypass_mode: BYPASS_MODE_ALWAYS,
}

/**
 * Whether `actors` carries the standing Repository-admin always-allow entry.
 */
export function hasRepositoryAdminBypass(
  actors: readonly BypassActor[],
): boolean {
  return actors.some(
    a =>
      a.actor_type === ACTOR_TYPE_REPOSITORY_ROLE &&
      a.actor_id === REPOSITORY_ROLE_ADMIN_ID &&
      a.bypass_mode === BYPASS_MODE_ALWAYS,
  )
}

/**
 * The fields of a ruleset this tool round-trips. `conditions` and `rules` are
 * held as opaque parsed JSON and written back verbatim.
 */
export interface RulesetSnapshot {
  readonly id: number
  readonly name: string
  readonly target: string
  readonly enforcement: string
  readonly conditions: unknown
  readonly rules: readonly unknown[]
  readonly bypassActors: readonly BypassActor[]
}

/**
 * A resolved fleet-roster target: the owner and repo name to address.
 */
export interface FleetRepoTarget {
  readonly owner: string
  readonly name: string
}

/**
 * The authenticated `gh` account a grant applies to.
 */
export interface GhAccount {
  readonly id: number
  readonly login: string
}

/**
 * The outcome of one `gh` invocation, success or failure.
 */
export interface GhResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

/**
 * The `gh` seam. `body`, when given, is a JSON request body; the CLI's default
 * implementation writes it to a temp file and passes `gh api --input <file>`.
 * Injectable so the whole flow is testable without touching GitHub.
 */
export type GhFn = (
  args: readonly string[],
  body?: string | undefined,
) => Promise<GhResult>

/**
 * Resolve a bare repo name against the fleet roster, returning its owner and
 * canonical name, or undefined when the name is not a roster member. The
 * roster read single-sources BOTH membership and the owner, so a member can
 * never be addressed at the wrong org. Case-insensitive: GitHub slugs are.
 * Pure; exported for tests.
 */
export function resolveFleetRepoTarget(
  rosterJson: string,
  repoName: string,
): FleetRepoTarget | undefined {
  let repos
  try {
    repos = parseFleetRepos(rosterJson)
  } catch {
    return undefined
  }
  const wanted = repoName.toLowerCase()
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const entry = repos[i]!
    if (entry.name.toLowerCase() === wanted) {
      return { owner: entry.owner, name: entry.name }
    }
  }
  return undefined
}

/**
 * Parse `gh api user` into the actor a grant applies to, or undefined when
 * the payload lacks a numeric id — the ONLY thing GitHub's bypass_actors
 * accepts. Pure; exported for tests.
 */
export function parseAuthenticatedGhUser(json: string): GhAccount | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  const entry = data as {
    id?: unknown | undefined
    login?: unknown | undefined
  }
  if (typeof entry?.id !== 'number') {
    return undefined
  }
  return {
    id: entry.id,
    login: typeof entry.login === 'string' ? entry.login : String(entry.id),
  }
}

// One `bypass_actors` entry, or undefined when the shape is not what GitHub
// documents. An unparseable actor is dropped rather than guessed at, and the
// caller's preservation check catches a write that would have lost one.
function readBypassActor(value: unknown): BypassActor | undefined {
  const entry = value as {
    actor_id?: unknown | undefined
    actor_type?: unknown | undefined
    bypass_mode?: unknown | undefined
  }
  if (
    typeof entry?.actor_id !== 'number' ||
    typeof entry?.actor_type !== 'string'
  ) {
    return undefined
  }
  return {
    actor_id: entry.actor_id,
    actor_type: entry.actor_type,
    bypass_mode:
      typeof entry.bypass_mode === 'string'
        ? entry.bypass_mode
        : BYPASS_MODE_ALWAYS,
  }
}

/**
 * Parse a single `gh api repos/<owner>/<repo>/rulesets/<id>` response into the
 * fields this tool round-trips, or undefined when the payload is not a
 * readable ruleset object. An unreadable read must abort the write: writing
 * from a half-parsed model is how rules get dropped. Pure; exported for tests.
 */
export function parseRulesetSnapshot(
  json: string,
): RulesetSnapshot | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  const entry = data as {
    bypass_actors?: unknown | undefined
    conditions?: unknown | undefined
    enforcement?: unknown | undefined
    id?: unknown | undefined
    name?: unknown | undefined
    rules?: unknown | undefined
    target?: unknown | undefined
  }
  if (
    typeof entry?.id !== 'number' ||
    typeof entry?.name !== 'string' ||
    !Array.isArray(entry?.rules)
  ) {
    return undefined
  }
  const actors: BypassActor[] = []
  const rawActors = Array.isArray(entry.bypass_actors)
    ? entry.bypass_actors
    : []
  for (let i = 0, { length } = rawActors; i < length; i += 1) {
    const actor = readBypassActor(rawActors[i])
    if (actor !== undefined) {
      actors.push(actor)
    }
  }
  return {
    id: entry.id,
    name: entry.name,
    target: typeof entry.target === 'string' ? entry.target : 'branch',
    enforcement:
      typeof entry.enforcement === 'string' ? entry.enforcement : 'active',
    conditions: entry.conditions,
    rules: entry.rules,
    bypassActors: actors,
  }
}

/**
 * The rule types carried by a snapshot's opaque `rules` array — the value the
 * post-write verification diffs. Pure; exported for tests.
 */
export function ruleTypesOfSnapshot(
  snapshot: RulesetSnapshot,
): readonly string[] {
  const out: string[] = []
  const { rules } = snapshot
  for (let i = 0, { length } = rules; i < length; i += 1) {
    const rule = rules[i] as { type?: unknown | undefined }
    if (typeof rule?.type === 'string') {
      out.push(rule.type)
    }
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * True when `actorId` already holds a User bypass on this ruleset. Pure;
 * exported for tests.
 */
export function hasRulesetBypassActor(
  actors: readonly BypassActor[],
  actorId: number,
): boolean {
  return actors.some(
    a => a.actor_type === ACTOR_TYPE_USER && a.actor_id === actorId,
  )
}

/**
 * The bypass-actor array with `actorId` present as an always-mode User.
 * Idempotent: an existing entry for that actor is returned untouched, so a
 * repeated grant is a no-op rather than a duplicate. Every other actor is
 * preserved in order. Pure; exported for tests.
 */
export function withRulesetBypassActor(
  actors: readonly BypassActor[],
  actorId: number,
): readonly BypassActor[] {
  if (hasRulesetBypassActor(actors, actorId)) {
    return actors
  }
  return [
    ...actors,
    {
      actor_id: actorId,
      actor_type: ACTOR_TYPE_USER,
      bypass_mode: BYPASS_MODE_ALWAYS,
    },
  ]
}

/**
 * The bypass-actor array with the User entry for `actorId` removed. Only that
 * one actor is dropped — a Team or Integration actor sharing the numeric id
 * belongs to a different namespace and is preserved. Pure; exported for tests.
 */
export function withoutRulesetBypassActor(
  actors: readonly BypassActor[],
  actorId: number,
): readonly BypassActor[] {
  return actors.filter(
    a => !(a.actor_type === ACTOR_TYPE_USER && a.actor_id === actorId),
  )
}

/**
 * The write body: every field read back from GitHub, verbatim, with only
 * `bypass_actors` swapped. Nothing here is re-specified from a local model of
 * what the ruleset "should" contain — that is the owning check script's job,
 * and duplicating it here is how the two would drift. Pure; exported for
 * tests.
 */
export function rulesetBypassPatchBody(
  snapshot: RulesetSnapshot,
  actors: readonly BypassActor[],
): Record<string, unknown> {
  return {
    name: snapshot.name,
    target: snapshot.target,
    enforcement: snapshot.enforcement,
    conditions: snapshot.conditions,
    rules: snapshot.rules,
    bypass_actors: actors,
  }
}

/**
 * The rule types present before a write and missing after it — empty when the
 * write preserved the ruleset. A non-empty result means the write silently
 * rewrote the protection this tool is only supposed to add an exemption to.
 * Pure; exported for tests.
 */
export function droppedRuleTypes(
  before: readonly string[],
  after: readonly string[],
): readonly string[] {
  const present = new Set(after)
  return before.filter(t => !present.has(t))
}
