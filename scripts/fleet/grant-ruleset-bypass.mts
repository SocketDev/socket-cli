#!/usr/bin/env node
/*
 * @file Operator tool: read, grant, or revoke a SELF bypass on one of the
 *   fleet's managed protection rulesets.
 *   WHICH RULESET IS A FLAG. The default — no flag at all, or an explicit
 *   `--branch` — is `fleet-main-protection`, the branch ruleset on
 *   `~DEFAULT_BRANCH`. `--tags` selects `fleet-tag-protection`, the tag
 *   ruleset on `refs/tags/v*`. Both identities come from
 *   `_shared/managed-ruleset-identity.mts`, which derives each one from the
 *   ONE check script that owns that ruleset's shape.
 *   Both rulesets carry `deletion` + `non_fast_forward` with ZERO bypass
 *   actors, so GitHub refuses a force-push of the default branch and a delete
 *   of a `v*` tag for everyone, a repo admin included. A squash-history
 *   rewrite, a lease-force reconcile, an amend-and-push, or deleting a loose
 *   `v1` alias tag therefore needs a temporary exemption. This is the codified
 *   form of that exemption — the hand-run `gh api --method PUT` it replaces
 *   sent a full body from memory, which silently rewrites whatever it omits.
 *   SELF-EXPIRING BY CONSTRUCTION. The selected ruleset's owning check `--fix`
 *   rewrites it to a canonical body whose JSON has no `bypass_actors` field at
 *   all, so that run revokes every grant made here. GitHub additionally logs
 *   `Bypassed rule violations` on each use, so a grant is auditable after the
 *   fact. Every grant prints both facts — nobody should read a grant as
 *   durable.
 *   REFLEXIVE ONLY. There is no `--user` flag. The actor is always the
 *   authenticated `gh` account (`gh api user`), so the tool can widen access
 *   to the operator running it and to nobody else. An operator-supplied actor
 *   id would turn a self-exemption into a grant-to-a-third-party primitive;
 *   that capability has no caller here.
 *   READ-MODIFY-WRITE, NEVER RE-SPECIFY. The write body is built from the
 *   ruleset GitHub currently reports — name, target, enforcement, conditions,
 *   and rules are carried across verbatim, with only `bypass_actors` replaced.
 *   A ruleset whose live target disagrees with the selected identity is
 *   refused before any write, so a `--tags` run can never land on a branch
 *   ruleset. After the write the ruleset is re-read and its rule types are
 *   diffed against the pre-write set; a dropped rule fails the run loudly.
 *   This file never invents a ruleset: an absent managed ruleset is a hard
 *   stop pointing at the one script that owns its shape.
 *   Usage:
 *   node scripts/fleet/grant-ruleset-bypass.mts <repo>          # status
 *   node scripts/fleet/grant-ruleset-bypass.mts <repo> --grant --yes
 *   node scripts/fleet/grant-ruleset-bypass.mts <repo> --revoke
 *   node scripts/fleet/grant-ruleset-bypass.mts <repo> --grant --yes --tags
 *   Exit codes:
 *
 *   - 0 — status printed, or the ruleset already matches the requested state, or
 *     the write applied and verified.
 *   - 1 — bad args, non-member repo, absent ruleset, unreadable ruleset, a
 *     target mismatch, a rejected write (no admin scope), or a post-write
 *     verification failure.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'
import {
  DEFAULT_RULESET_SELECTOR,
  findRulesetIdentityByFlag,
  resolveManagedRulesetIdentity,
} from './_shared/managed-ruleset-identity.mts'
import type {
  ManagedRulesetIdentity,
  ManagedRulesetSelector,
} from './_shared/managed-ruleset-identity.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'
import { fleetReposPath } from './check/member-ci-fires-on-push.mts'
import {
  absentRulesetRefusal,
  expiryNotice,
  ghFailureRefusal,
  grantNeedsYesRefusal,
  nonMemberRefusal,
  rosterMissingRefusal,
  ruleDropRefusal,
  statusReport,
  targetMismatchRefusal,
  usageText,
} from './grant-ruleset-bypass/messages.mts'
import {
  droppedRuleTypes,
  hasRulesetBypassActor,
  parseAuthenticatedGhUser,
  parseRulesetSnapshot,
  resolveFleetRepoTarget,
  rulesetBypassPatchBody,
  ruleTypesOfSnapshot,
  TOOL_NAME,
  withoutRulesetBypassActor,
  withRulesetBypassActor,
} from './grant-ruleset-bypass/ruleset-model.mts'
import type {
  BypassActor,
  FleetRepoTarget,
  GhAccount,
  GhFn,
  GhResult,
  RulesetSnapshot,
} from './grant-ruleset-bypass/ruleset-model.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

/**
 * What the operator asked for.
 */
export type BypassAction = 'status' | 'grant' | 'revoke'

/**
 * The parsed command line.
 */
export interface RulesetBypassArgs {
  readonly repo: string | undefined
  readonly action: BypassAction
  readonly selector: ManagedRulesetSelector
  readonly confirmed: boolean
  readonly invalid: string | undefined
}

/**
 * Parse argv into an action, a ruleset selector, and a target. The first
 * non-flag token is the repo. Status is the default so the common case — "who
 * can bypass this ruleset right now?" — never travels the mutating path, and
 * the branch ruleset is the default selector so an invocation written before a
 * second ruleset existed keeps its meaning. Pure; exported for tests.
 */
export function parseRulesetBypassArgs(
  argv: readonly string[],
): RulesetBypassArgs {
  let repo: string | undefined
  let grant = false
  let revoke = false
  let confirmed = false
  let unknownFlag: string | undefined
  const selectors: ManagedRulesetSelector[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    const identity = findRulesetIdentityByFlag(arg)
    if (identity !== undefined) {
      selectors.push(identity.selector)
    } else if (arg === '--grant') {
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
  const chosen = [...new Set(selectors)]
  const clashing = chosen.map(s => resolveManagedRulesetIdentity(s).flag)
  const invalid =
    grant && revoke
      ? '--grant and --revoke are mutually exclusive; pick one.'
      : chosen.length > 1
        ? `${clashing.join(' and ')} are mutually exclusive; pick one.`
        : unknownFlag !== undefined
          ? `Unrecognized flag ${unknownFlag}.`
          : undefined
  return {
    repo,
    action: grant ? 'grant' : revoke ? 'revoke' : 'status',
    selector: chosen[0] ?? DEFAULT_RULESET_SELECTOR,
    confirmed,
    invalid,
  }
}

// The default `gh` seam. A JSON body is written to a temp file and passed via
// `gh api --input <file>`: the lib spawn does not wire the child's stdin, so
// `--input -` reads nothing. `{body}` in `args` is replaced with that path.
export async function runGh(
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
 * Read the selected managed ruleset for a target: locate it by name in the
 * repo's ruleset list, reusing the owning check's own locator so the two agree
 * on what "managed" means, then fetch it in full. Returns `'absent'` when the
 * list is readable and carries none, or a failure detail string when a call was
 * rejected.
 */
export async function readManagedRuleset(config: {
  readonly ghFn: GhFn
  readonly identity: ManagedRulesetIdentity
  readonly target: FleetRepoTarget
}): Promise<RulesetSnapshot | 'absent' | { readonly failure: string }> {
  const { ghFn, identity, target } = {
    __proto__: null,
    ...config,
  } as typeof config
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
  const managedId = identity.findRulesetId(listing.stdout)
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

// Apply a bypass-actor change and verify it from GitHub's own answer, never
// from this process's belief that the write succeeded.
async function applyBypassChange(config: {
  readonly actors: readonly BypassActor[]
  readonly ghFn: GhFn
  readonly identity: ManagedRulesetIdentity
  readonly snapshot: RulesetSnapshot
  readonly target: FleetRepoTarget
}): Promise<RulesetSnapshot | undefined> {
  const { actors, ghFn, identity, snapshot, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  const base = `repos/${target.owner}/${target.name}/rulesets/${snapshot.id}`
  const written = await ghFn(
    // PUT, not PATCH: GitHub's update-ruleset endpoint answers 404 to PATCH,
    // which reads as a permissions failure while reads succeed. The body is a
    // full read-modify-write of the snapshot, so replace semantics are correct.
    ['api', '-X', 'PUT', base, '--input', '{body}'],
    JSON.stringify(rulesetBypassPatchBody(snapshot, actors)),
  )
  if (!written.ok) {
    logger.error(
      ghFailureRefusal({
        detail: written.stderr,
        identity,
        target,
        what: `the write to ${identity.name} was rejected`,
      }),
    )
    return undefined
  }
  // Re-read rather than trust the write's own response: success is measured
  // from a fresh GET, which is also what proves the rules survived.
  const after = await readManagedRuleset({ ghFn, identity, target })
  if (typeof after === 'string' || 'failure' in after) {
    logger.error(
      ghFailureRefusal({
        detail:
          typeof after === 'string'
            ? 'the ruleset is gone after the write'
            : after.failure,
        identity,
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
    logger.error(ruleDropRefusal({ dropped, identity, target }))
    return undefined
  }
  return after
}

// Resolve the authenticated account, or undefined after logging the refusal.
async function resolveGhAccount(config: {
  readonly ghFn: GhFn
  readonly identity: ManagedRulesetIdentity
  readonly target: FleetRepoTarget
}): Promise<GhAccount | undefined> {
  const { ghFn, identity, target } = {
    __proto__: null,
    ...config,
  } as typeof config
  const who = await ghFn(['api', 'user', '--jq', '{id: .id, login: .login}'])
  if (!who.ok) {
    logger.error(
      ghFailureRefusal({
        detail: who.stderr,
        identity,
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
        identity,
        target,
        what: 'the authenticated gh account has no usable actor id',
      }),
    )
  }
  return account
}

/**
 * The whole flow over an injected `gh` seam and roster: resolve membership and
 * the selected ruleset identity, read that ruleset, then report / grant /
 * revoke. Returns the process exit code. Exported so tests drive every branch
 * without touching GitHub.
 */
export async function runRulesetBypass(config: {
  readonly args: RulesetBypassArgs
  readonly ghFn: GhFn
  readonly rosterJson: string
}): Promise<number> {
  const { args, ghFn, rosterJson } = {
    __proto__: null,
    ...config,
  } as typeof config
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
  const identity = resolveManagedRulesetIdentity(args.selector)
  const target = resolveFleetRepoTarget(rosterJson, args.repo)
  if (target === undefined) {
    logger.error(nonMemberRefusal({ identity, repoName: args.repo }))
    return 1
  }
  if (args.action === 'grant' && !args.confirmed) {
    logger.error(grantNeedsYesRefusal({ identity, target }))
    return 1
  }
  const snapshot = await readManagedRuleset({ ghFn, identity, target })
  if (snapshot === 'absent') {
    logger.error(absentRulesetRefusal({ identity, target }))
    return 1
  }
  if ('failure' in snapshot) {
    logger.error(
      ghFailureRefusal({
        detail: snapshot.failure,
        identity,
        target,
        what: `${identity.name} could not be read`,
      }),
    )
    return 1
  }
  if (snapshot.target !== identity.target) {
    logger.error(targetMismatchRefusal({ identity, snapshot, target }))
    return 1
  }
  if (args.action === 'status') {
    logger.log(statusReport({ identity, snapshot, target }))
    return 0
  }
  const account = await resolveGhAccount({ ghFn, identity, target })
  if (account === undefined) {
    return 1
  }
  const held = hasRulesetBypassActor(snapshot.bypassActors, account.id)
  if (args.action === 'grant' && held) {
    logger.log(
      `${TOOL_NAME}: ${account.login} already holds a bypass on ` +
        `${identity.name} in ${target.owner}/${target.name} — no change.\n` +
        expiryNotice({ identity, login: account.login }),
    )
    return 0
  }
  if (args.action === 'revoke' && !held) {
    logger.log(
      `${TOOL_NAME}: ${account.login} holds no bypass on ` +
        `${identity.name} in ${target.owner}/${target.name} — no change.`,
    )
    return 0
  }
  const nextActors =
    args.action === 'grant'
      ? withRulesetBypassActor(snapshot.bypassActors, account.id)
      : withoutRulesetBypassActor(snapshot.bypassActors, account.id)
  const after = await applyBypassChange({
    actors: nextActors,
    ghFn,
    identity,
    snapshot,
    target,
  })
  if (after === undefined) {
    return 1
  }
  if (args.action === 'revoke') {
    logger.log(
      `${TOOL_NAME}: revoked ${account.login}'s bypass on ${identity.name} ` +
        `in ${target.owner}/${target.name}. Rules intact: ` +
        `${ruleTypesOfSnapshot(after).join(', ')}.`,
    )
    return 0
  }
  logger.log(
    `${TOOL_NAME}: granted ${account.login} a bypass on ${identity.name} ` +
      `in ${target.owner}/${target.name}. Rules intact: ` +
      `${ruleTypesOfSnapshot(after).join(', ')}.\n` +
      expiryNotice({ identity, login: account.login }),
  )
  return 0
}

export async function main(): Promise<number> {
  const args = parseRulesetBypassArgs(process.argv.slice(2))
  const rosterPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(rosterPath)) {
    logger.error(rosterMissingRefusal(rosterPath))
    return 1
  }
  return await runRulesetBypass({
    args,
    ghFn: runGh,
    rosterJson: readFileSync(rosterPath, 'utf8'),
  })
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'reads, grants, or revokes a SELF bypass on a managed GitHub ruleset for one fleet repo',
  help: `Usage: node scripts/fleet/grant-ruleset-bypass.mts <repo> [flags]

  (no flags)  print the ruleset's bypass status
  --grant     add the SELF bypass (requires --yes to confirm)
  --revoke    remove the SELF bypass
  --status    print status explicitly
  --yes       confirm a --grant
  --tags      target the tag ruleset instead of the branch ruleset`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
