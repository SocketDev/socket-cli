#!/usr/bin/env node
/*
 * @file Operator tool: read, grant, or revoke a SELF force-push bypass on a
 *   fleet repo's `fleet-main-protection` branch ruleset.
 *   The ruleset (created and owned by
 *   `scripts/fleet/check/main-branch-rules-are-enforced.mts`) carries
 *   `deletion` + `non_fast_forward` on `~DEFAULT_BRANCH` with ZERO bypass
 *   actors, so force-pushing the default branch is impossible fleet-wide. A
 *   squash-history rewrite, a lease-force reconcile, or an amend-and-push
 *   therefore needs a temporary exemption. This is the codified form of that
 *   exemption — the hand-run `gh api --method PUT` it replaces sent a full
 *   body from memory, which silently rewrites whatever it omits.
 *   SELF-EXPIRING BY CONSTRUCTION. `main-branch-rules-are-enforced --fix`
 *   PATCHes the ruleset to `rulesetPayload()`, whose body has no
 *   `bypass_actors` field at all, so the next fix run wipes every grant made
 *   here. GitHub additionally logs `Bypassed rule violations` on each use, so
 *   a grant is auditable after the fact. Every grant prints both facts —
 *   nobody should read a grant as durable.
 *   REFLEXIVE ONLY. There is no `--user` flag. The actor is always the
 *   authenticated `gh` account (`gh api user`), so the tool can widen access
 *   to the operator running it and to nobody else. A hardcoded actor id, or
 *   an operator-supplied one, would turn a self-exemption into a
 *   grant-to-a-third-party primitive; that capability has no caller here.
 *   READ-MODIFY-WRITE, NEVER RE-SPECIFY. The PATCH body is built from the
 *   ruleset GitHub currently reports — name, target, enforcement, conditions,
 *   and rules are carried across verbatim, with only `bypass_actors`
 *   replaced. After the write the ruleset is re-read and its rule types are
 *   diffed against the pre-write set; a dropped rule fails the run loudly.
 *   This file never invents the ruleset: an absent `fleet-main-protection`
 *   is a hard stop pointing at the one script that owns its shape.
 *   Usage:
 *   node scripts/fleet/grant-main-bypass.mts <repo>            # status
 *   node scripts/fleet/grant-main-bypass.mts <repo> --grant --yes
 *   node scripts/fleet/grant-main-bypass.mts <repo> --revoke
 *   Exit codes:
 *
 *   - 0 — status printed, or the ruleset already matches the requested state, or
 *     the write applied and verified.
 *   - 1 — bad args, non-member repo, absent ruleset, unreadable ruleset, a
 *     rejected write (no admin scope), or a post-write verification failure.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLEET_ROSTER_REL } from './_shared/fleet-membership.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import {
  MANAGED_RULESET_NAME,
  parseManagedRulesetId,
} from './check/main-branch-rules-are-enforced.mts'
import {
  fleetReposPath,
  parseFleetRepos,
} from './check/member-ci-fires-on-push.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

/**
 * The tool name carried in every operator-facing message, so a line pasted
 * into a transcript names the script that produced it.
 */
export const TOOL_NAME = 'grant-main-bypass'

/**
 * The one script that owns the `fleet-main-protection` ruleset's shape —
 * named in the absent-ruleset refusal and in every grant's expiry notice.
 */
export const RULESET_OWNER_SCRIPT =
  'node scripts/fleet/check/main-branch-rules-are-enforced.mts --fix'

/**
 * GitHub's bypass-actor kind this tool manages. Only `User` actors are ever
 * added or removed; a `Team`, `Integration`, or `OrganizationAdmin` actor
 * placed by someone else is reported by status and left untouched by writes.
 */
export const ACTOR_TYPE_USER = 'User'

/**
 * `always` rather than `pull_request` — the exemption exists for a direct
 * force-push to the default branch, which never travels through a PR.
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
 * The fields of a ruleset this tool round-trips. `conditions` and `rules` are
 * held as opaque parsed JSON and written back verbatim: re-specifying either
 * from a local model is exactly how a hand-run PUT drops a rule.
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
 * The `gh` seam. `body`, when given, is a JSON request body; the default
 * implementation writes it to a temp file and passes `gh api --input <file>`.
 * Injectable so the whole flow is testable without touching GitHub.
 */
export type GhFn = (
  args: readonly string[],
  body?: string | undefined,
) => Promise<GhResult>

/**
 * What the operator asked for.
 */
export type BypassAction = 'status' | 'grant' | 'revoke'

/**
 * The parsed command line.
 */
export interface MainBypassArgs {
  readonly repo: string | undefined
  readonly action: BypassAction
  readonly confirmed: boolean
  readonly invalid: string | undefined
}

/**
 * Parse argv into an action plus its target. The first non-flag token is the
 * repo. Status is the default so the common case — "who can force-push this
 * repo right now?" — never travels the mutating path. Pure; exported for
 * tests.
 */
export function parseMainBypassArgs(argv: readonly string[]): MainBypassArgs {
  let repo: string | undefined
  let grant = false
  let revoke = false
  let confirmed = false
  let unknownFlag: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--grant') {
      grant = true
    } else if (arg === '--revoke') {
      revoke = true
    } else if (arg === '--status') {
      // Explicit spelling of the default; carries no extra effect.
      continue
    } else if (arg === '--yes') {
      confirmed = true
    } else if (arg.startsWith('-')) {
      unknownFlag ??= arg
    } else if (repo === undefined) {
      repo = arg
    }
  }
  const invalid =
    grant && revoke
      ? '--grant and --revoke are mutually exclusive; pick one.'
      : unknownFlag !== undefined
        ? `Unrecognized flag ${unknownFlag}.`
        : undefined
  return {
    repo,
    action: grant ? 'grant' : revoke ? 'revoke' : 'status',
    confirmed,
    invalid,
  }
}

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
 * readable ruleset object. An unreadable read must abort the write: PATCHing
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
 * The bypass-actor array with `actorId` present as an always-mode User.
 * Idempotent: an existing entry for that actor is returned untouched, so a
 * repeated grant is a no-op rather than a duplicate. Every other actor is
 * preserved in order. Pure; exported for tests.
 */
export function withMainBypassActor(
  actors: readonly BypassActor[],
  actorId: number,
): readonly BypassActor[] {
  if (hasMainBypassActor(actors, actorId)) {
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
export function withoutMainBypassActor(
  actors: readonly BypassActor[],
  actorId: number,
): readonly BypassActor[] {
  return actors.filter(
    a => !(a.actor_type === ACTOR_TYPE_USER && a.actor_id === actorId),
  )
}

/**
 * True when `actorId` already holds a User bypass on this ruleset. Pure;
 * exported for tests.
 */
export function hasMainBypassActor(
  actors: readonly BypassActor[],
  actorId: number,
): boolean {
  return actors.some(
    a => a.actor_type === ACTOR_TYPE_USER && a.actor_id === actorId,
  )
}

/**
 * The PATCH body: every field read back from GitHub, verbatim, with only
 * `bypass_actors` swapped. Nothing here is re-specified from a local model of
 * what the ruleset "should" contain — that is the job of
 * `main-branch-rules-are-enforced`, and duplicating it here is how the two
 * would drift. Pure; exported for tests.
 */
export function mainBypassPatchBody(
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
 * write preserved the ruleset. A non-empty result means the PATCH silently
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

/**
 * Human-readable bypass-actor list for status output, or an explicit
 * "none" line — an empty ruleset must never render as blank, which reads as
 * a failed query. Pure; exported for tests.
 */
export function formatBypassActors(actors: readonly BypassActor[]): string {
  if (actors.length === 0) {
    return '  (none — nobody can force-push or delete the default branch)'
  }
  return actors
    .map(
      a => `  - ${a.actor_type} ${a.actor_id} (bypass_mode: ${a.bypass_mode})`,
    )
    .join('\n')
}

/**
 * The refusal for a repo that is not on the fleet roster. Fleet tooling writes
 * only into roster members, and this tool writes a security-relevant setting,
 * so there is deliberately no `--allow-non-member` hatch: a non-member repo has
 * no `fleet-main-protection` ruleset for this tool to have an opinion about.
 * Pure; exported for tests.
 */
export function nonMemberRefusal(repoName: string): string {
  return [
    `[${TOOL_NAME}] Refused: '${repoName}' is not a fleet-roster member.`,
    `  Where:  the canonical roster, ${FLEET_ROSTER_REL}`,
    `  Saw:    '${repoName}', which that roster does not list.`,
    '  Wanted: a bare roster repo name, e.g. socket-cli.',
    '  Fix:    check the spelling, or add the repo to the roster first.',
    `          This tool has no non-member escape hatch — a non-member has no`,
    `          ${MANAGED_RULESET_NAME} ruleset to exempt anyone from.`,
  ].join('\n')
}

/**
 * The hard stop for a repo whose managed ruleset does not exist. This tool
 * never creates it: one script owns that ruleset's shape, and a second
 * creator would let the two definitions drift. Pure; exported for tests.
 */
export function absentRulesetRefusal(target: FleetRepoTarget): string {
  return [
    `[${TOOL_NAME}] Refused: no ${MANAGED_RULESET_NAME} ruleset to grant against.`,
    `  Where:  ${target.owner}/${target.name} — repo-level rulesets.`,
    `  Saw:    the ruleset list is readable and carries no Repository-sourced`,
    `          ruleset named ${MANAGED_RULESET_NAME}.`,
    '  Wanted: the canonical protection ruleset, already in place.',
    `  Fix:    create it with the one script that owns its shape —`,
    `          ${RULESET_OWNER_SCRIPT}`,
    `          then re-run this tool. It is never created here.`,
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
  readonly target: FleetRepoTarget
  readonly what: string
}): string {
  const { detail, target, what } = config
  return [
    `[${TOOL_NAME}] Failed: ${what}.`,
    `  Where:  ${target.owner}/${target.name} — ${MANAGED_RULESET_NAME}.`,
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
  readonly target: FleetRepoTarget
}): string {
  const { dropped, target } = config
  return [
    `[${TOOL_NAME}] Failed: the write DROPPED protection rules.`,
    `  Where:  ${target.owner}/${target.name} — ${MANAGED_RULESET_NAME}.`,
    `  Saw:    these rule types are gone after the PATCH: ${dropped.join(', ')}.`,
    '  Wanted: an unchanged rule set, with only bypass_actors modified.',
    `  Fix:    restore the ruleset now — ${RULESET_OWNER_SCRIPT}`,
  ].join('\n')
}

/**
 * The expiry notice printed after every successful grant. A grant that reads
 * as durable is the failure mode this line exists to prevent. Pure; exported
 * for tests.
 */
export function expiryNotice(login: string): string {
  return [
    `  This grant is TEMPORARY and self-expiring:`,
    `    - ${RULESET_OWNER_SCRIPT} rewrites the ruleset to its canonical body,`,
    `      which carries no bypass_actors at all — that run revokes this grant.`,
    `    - GitHub logs a "Bypassed rule violations" entry each time ${login} uses it.`,
    `  Revoke it yourself when done: re-run with --revoke.`,
  ].join('\n')
}

// The default `gh` seam. A JSON body is written to a temp file and passed via
// `gh api --input <file>`: the lib spawn does not wire the child's stdin, so
// `--input -` reads nothing. `{body}` in `args` is replaced with that path.
async function runGh(
  args: readonly string[],
  body?: string | undefined,
): Promise<GhResult> {
  let file: string | undefined
  let resolved = [...args]
  if (body !== undefined) {
    file = path.join(os.tmpdir(), `${TOOL_NAME}-${process.pid}.json`)
    writeFileSync(file, body)
    resolved = resolved.map(a => (a === '{body}' ? file! : a))
  }
  try {
    const result = await spawn('gh', resolved, {
      stdio: 'pipe',
      stdioString: true,
      timeout: 30_000,
    })
    return {
      ok: true,
      stdout: String(result.stdout ?? '').trim(),
      stderr: String(result.stderr ?? '').trim(),
    }
  } catch (e) {
    const err = e as {
      stderr?: unknown | undefined
      stdout?: unknown | undefined
    }
    const stderr = String(err?.stderr ?? '').trim()
    return {
      ok: false,
      stdout: String(err?.stdout ?? '').trim(),
      stderr: stderr || errorMessage(e),
    }
  } finally {
    if (file !== undefined) {
      safeDeleteSync(file)
    }
  }
}

/**
 * Read the managed ruleset for a target: locate it by name in the repo's
 * ruleset list (reusing the check's own locator so the two agree on what
 * "managed" means), then fetch it in full. Returns `'absent'` when the list is
 * readable and carries none, or a failure detail string when a call was
 * rejected.
 */
export async function readManagedRuleset(config: {
  readonly ghFn: GhFn
  readonly target: FleetRepoTarget
}): Promise<RulesetSnapshot | 'absent' | { readonly failure: string }> {
  const { ghFn, target } = config
  const base = `repos/${target.owner}/${target.name}/rulesets`
  const listing = await ghFn([
    'api',
    base,
    '--jq',
    '[.[] | {id: .id, name: .name, source_type: .source_type}]',
  ])
  if (!listing.ok) {
    return { failure: listing.stderr }
  }
  const managedId = parseManagedRulesetId(listing.stdout)
  if (managedId === undefined) {
    return {
      failure: `ruleset list unparseable: ${listing.stdout.slice(0, 200)}`,
    }
  }
  if (managedId === 'absent') {
    return 'absent'
  }
  const detail = await ghFn(['api', `${base}/${managedId}`])
  if (!detail.ok) {
    return { failure: detail.stderr }
  }
  const snapshot = parseRulesetSnapshot(detail.stdout)
  if (snapshot === undefined) {
    return { failure: `ruleset ${managedId} unparseable — refusing to write` }
  }
  return snapshot
}

// Print the current bypass actors. Read-only; the default path.
function reportStatus(
  target: FleetRepoTarget,
  snapshot: RulesetSnapshot,
): void {
  logger.log(
    `${TOOL_NAME}: ${target.owner}/${target.name} — ${MANAGED_RULESET_NAME} ` +
      `(${snapshot.enforcement}, rules: ${ruleTypesOfSnapshot(snapshot).join(', ')})`,
  )
  logger.log('  bypass actors:')
  logger.log(formatBypassActors(snapshot.bypassActors))
}

// Apply a bypass-actor change and verify it from GitHub's own answer, never
// from this process's belief that the PATCH succeeded.
async function applyBypassChange(config: {
  readonly actors: readonly BypassActor[]
  readonly ghFn: GhFn
  readonly snapshot: RulesetSnapshot
  readonly target: FleetRepoTarget
}): Promise<RulesetSnapshot | undefined> {
  const { actors, ghFn, snapshot, target } = config
  const base = `repos/${target.owner}/${target.name}/rulesets/${snapshot.id}`
  const written = await ghFn(
    ['api', '-X', 'PATCH', base, '--input', '{body}'],
    JSON.stringify(mainBypassPatchBody(snapshot, actors)),
  )
  if (!written.ok) {
    logger.error(
      ghFailureRefusal({
        detail: written.stderr,
        target,
        what: `the PATCH of ${MANAGED_RULESET_NAME} was rejected`,
      }),
    )
    return undefined
  }
  // Re-read rather than trust the PATCH response: success is measured from a
  // fresh GET, which is also what proves the rules survived.
  const after = await readManagedRuleset({ ghFn, target })
  if (typeof after === 'string' || 'failure' in after) {
    logger.error(
      ghFailureRefusal({
        detail:
          typeof after === 'string'
            ? 'the ruleset is gone after the write'
            : after.failure,
        target,
        what: 'the post-write verification read failed',
      }),
    )
    return undefined
  }
  const dropped = droppedRuleTypes(
    ruleTypesOfSnapshot(snapshot),
    ruleTypesOfSnapshot(after),
  )
  if (dropped.length > 0) {
    logger.error(ruleDropRefusal({ dropped, target }))
    return undefined
  }
  return after
}

// Resolve the authenticated account, or undefined after logging the refusal.
async function resolveGhAccount(
  ghFn: GhFn,
  target: FleetRepoTarget,
): Promise<GhAccount | undefined> {
  const who = await ghFn(['api', 'user', '--jq', '{id: .id, login: .login}'])
  if (!who.ok) {
    logger.error(
      ghFailureRefusal({
        detail: who.stderr,
        target,
        what: 'the authenticated gh account could not be read',
      }),
    )
    return undefined
  }
  const account = parseAuthenticatedGhUser(who.stdout)
  if (account === undefined) {
    logger.error(
      ghFailureRefusal({
        detail: `gh api user returned no numeric id: ${who.stdout.slice(0, 200)}`,
        target,
        what: 'the authenticated gh account has no usable actor id',
      }),
    )
  }
  return account
}

/**
 * The whole flow over an injected `gh` seam and roster: resolve membership,
 * read the managed ruleset, then report / grant / revoke. Returns the process
 * exit code. Exported so tests drive every branch without touching GitHub.
 */
export async function runMainBypass(config: {
  readonly args: MainBypassArgs
  readonly ghFn: GhFn
  readonly rosterJson: string
}): Promise<number> {
  const { args, ghFn, rosterJson } = config
  if (args.invalid !== undefined) {
    logger.error(`[${TOOL_NAME}] ${args.invalid}`)
    logger.error('')
    logger.error(usageText())
    return 1
  }
  if (args.repo === undefined) {
    logger.error(`[${TOOL_NAME}] Missing <repo>.`)
    logger.error('')
    logger.error(usageText())
    return 1
  }
  const target = resolveFleetRepoTarget(rosterJson, args.repo)
  if (target === undefined) {
    logger.error(nonMemberRefusal(args.repo))
    return 1
  }
  if (args.action === 'grant' && !args.confirmed) {
    logger.error(
      [
        `[${TOOL_NAME}] Refused: --grant needs --yes.`,
        `  Where:  ${target.owner}/${target.name} — ${MANAGED_RULESET_NAME}.`,
        '  Saw:    --grant with no confirmation flag.',
        '  Wanted: an explicit acknowledgement that this exempts you from the',
        '          force-push and deletion rules on the default branch.',
        `  Fix:    re-run with --yes, or drop --grant to just read the current`,
        '          actors.',
      ].join('\n'),
    )
    return 1
  }
  const snapshot = await readManagedRuleset({ ghFn, target })
  if (snapshot === 'absent') {
    logger.error(absentRulesetRefusal(target))
    return 1
  }
  if ('failure' in snapshot) {
    logger.error(
      ghFailureRefusal({
        detail: snapshot.failure,
        target,
        what: `${MANAGED_RULESET_NAME} could not be read`,
      }),
    )
    return 1
  }
  if (args.action === 'status') {
    reportStatus(target, snapshot)
    return 0
  }
  const account = await resolveGhAccount(ghFn, target)
  if (account === undefined) {
    return 1
  }
  const held = hasMainBypassActor(snapshot.bypassActors, account.id)
  if (args.action === 'grant' && held) {
    logger.log(
      `${TOOL_NAME}: ${account.login} already holds a bypass on ` +
        `${target.owner}/${target.name} — no change.\n${expiryNotice(account.login)}`,
    )
    return 0
  }
  if (args.action === 'revoke' && !held) {
    logger.log(
      `${TOOL_NAME}: ${account.login} holds no bypass on ` +
        `${target.owner}/${target.name} — no change.`,
    )
    return 0
  }
  const nextActors =
    args.action === 'grant'
      ? withMainBypassActor(snapshot.bypassActors, account.id)
      : withoutMainBypassActor(snapshot.bypassActors, account.id)
  const after = await applyBypassChange({
    actors: nextActors,
    ghFn,
    snapshot,
    target,
  })
  if (after === undefined) {
    return 1
  }
  if (args.action === 'revoke') {
    logger.log(
      `${TOOL_NAME}: revoked ${account.login}'s bypass on ` +
        `${target.owner}/${target.name}. Rules intact: ` +
        `${ruleTypesOfSnapshot(after).join(', ')}.`,
    )
    return 0
  }
  logger.log(
    `${TOOL_NAME}: granted ${account.login} a force-push bypass on ` +
      `${target.owner}/${target.name}. Rules intact: ` +
      `${ruleTypesOfSnapshot(after).join(', ')}.\n${expiryNotice(account.login)}`,
  )
  return 0
}

/**
 * The usage block, shared by the arg-error paths. Pure; exported for tests.
 */
export function usageText(): string {
  return [
    `Usage: node scripts/fleet/${TOOL_NAME}.mts <repo> [--grant --yes | --revoke]`,
    '',
    '  <repo>          A fleet-roster repo name, e.g. socket-cli.',
    "  (no action)     Read-only: list the ruleset's current bypass actors.",
    '  --grant --yes   Exempt the authenticated gh account from the default',
    "                  branch's force-push and deletion rules.",
    "  --revoke        Remove that same account's exemption.",
    '',
    `A grant applies to the authenticated account only — there is no --user`,
    `flag. It is self-expiring: ${RULESET_OWNER_SCRIPT}`,
    'rewrites the ruleset without any bypass actors.',
  ].join('\n')
}

export async function main(): Promise<number> {
  const args = parseMainBypassArgs(process.argv.slice(2))
  const rosterPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(rosterPath)) {
    logger.error(
      [
        `[${TOOL_NAME}] Refused: the fleet roster is missing.`,
        `  Where:  ${rosterPath}`,
        '  Saw:    no such file — membership is unresolvable.',
        '  Wanted: the canonical roster, present in the checkout.',
        '  Fix:    run this from a fleet checkout with the roster cascaded in.',
      ].join('\n'),
    )
    return 1
  }
  return await runMainBypass({
    args,
    ghFn: runGh,
    rosterJson: readFileSync(rosterPath, 'utf8'),
  })
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main)
}
/* c8 ignore stop */
