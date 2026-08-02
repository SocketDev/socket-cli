#!/usr/bin/env node
/**
 * @file Assertion: every fleet member's default branch (main) is protected by
 *   EFFECTIVE repository rules — a `deletion` rule on all repos, and a
 *   `non_fast_forward` (block force push) rule on every repo EXCEPT those
 *   with `squash-history` in their roster optIns (those force-push main by
 *   design via the squashing-history skill; a non_fast_forward rule would
 *   brick that flow). Pull requests are deliberately NOT required — the fleet
 *   is push-to-main by doctrine. Found fleet-wide on 2026-07-28: classic
 *   branch protection 404s on every spot-checked repo, the only enforced
 *   ruleset is org-wide commit signing, and socket-cli's protective ruleset
 *   sits at enforcement:disabled — so main accepts force-push and deletion
 *   everywhere, which is why MODE is strict from day one.
 *   The read is `gh api repos/<owner>/<name>/rules/branches/main` — the
 *   EFFECTIVE-rules endpoint, which aggregates org + repo rulesets and
 *   already filters by enforcement status, so an existing-but-disabled
 *   ruleset (socket-cli's) correctly shows as missing rules. An unreadable
 *   answer — 404 repo, network, auth — yields NO findings; only a concrete
 *   readable rule list counts, so the audit never invents a finding it
 *   cannot stand behind (member-repos-resolve owns missing repos).
 *   THE LAW IS THE FIX: `--fix` manages exactly ONE repo-level ruleset named
 *   `fleet-main-protection` targeting `~DEFAULT_BRANCH`, containing exactly
 *   the rules the law prescribes for that repo. If a ruleset with that name
 *   exists it is PATCHed to the canonical shape and enforcement:active; if
 *   missing it is POSTed. No OTHER ruleset is ever touched — org rulesets,
 *   socket-cli's disabled `default branch` ruleset, and its `e2e tests must
 *   pass` ruleset are all out of scope. After fixing, the check re-reads the
 *   effective rules so success is measured from GitHub's answer, never the
 *   fixer's belief.
 *   Skips CLEANLY — never false-green — off the release/CI tier
 *   (FLEET_CHECK_RELEASE), in a member checkout (wheelhouse-only, gated on
 *   template/base ownership), with no fleet-repos.json (a fresh clone
 *   mid-bootstrap), or when `gh` is unauthenticated.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'
import {
  parseRepoFilter,
  selectRepos,
  unmatchedSelectorMessage,
} from '../_shared/repo-filter.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'
import type { FleetRepo } from './member-ci-fires-on-push.mts'

const logger = getDefaultLogger()

// Strict from day one: the 2026-07-28 audit found the gap live fleet-wide, so
// a finding here is a real open door — force-pushable, deletable main — never
// a known-open backlog item (contrast member-ci-fires-on-push's report mode).
const MODE: 'report' | 'strict' = 'strict'

/**
 * The rule that must be effective on main for EVERY fleet repo: nobody
 * deletes a default branch by design.
 */
export const RULE_DELETION = 'deletion'

/**
 * The rule that must be effective on main for every repo WITHOUT the
 * squash-history opt-in: block force push.
 */
export const RULE_NON_FAST_FORWARD = 'non_fast_forward'

/**
 * The roster opt-in that exempts a repo from {@link RULE_NON_FAST_FORWARD}:
 * squash-history members rewrite main on purpose (the squashing-history
 * skill force-pushes the squashed history), so blocking force-push would
 * brick their sanctioned flow. It does NOT exempt {@link RULE_DELETION}.
 */
export const SQUASH_HISTORY_OPT_IN = 'squash-history'

/**
 * The ONE repo-level ruleset `--fix` manages. Anything else — org rulesets,
 * pre-existing repo rulesets under other names — is never created, patched,
 * or deleted by this check.
 */
export const MANAGED_RULESET_NAME = 'fleet-main-protection'

export interface RuleFinding {
  readonly repo: string
  readonly owner: string
  readonly rule: string
}

/**
 * One remediation the law prescribes: bring the managed ruleset on a repo to
 * the canonical shape carrying exactly these rule types.
 */
export interface FixAction {
  readonly repo: string
  readonly owner: string
  readonly rules: readonly string[]
}

/**
 * Each roster repo's optIns, keyed by repo name. Parses the same
 * fleet-repos.json that `parseFleetRepos` reads (that helper deliberately
 * projects only name/owner, so the opt-in read lives here). Tolerant by
 * design: malformed JSON, a missing repos array, or a missing/ill-typed
 * optIns field all degrade to "no opt-ins" — the strictest law — never a
 * crash. Pure; exported for tests.
 */
export function parseFleetOptIns(
  json: string,
): Record<string, readonly string[]> {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return {}
  }
  const repos = (data as { repos?: unknown | undefined })?.repos
  if (!Array.isArray(repos)) {
    return {}
  }
  const out: Record<string, readonly string[]> = {}
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const entry = repos[i] as {
      name?: unknown | undefined
      optIns?: unknown | undefined
    }
    if (typeof entry?.name !== 'string') {
      continue
    }
    out[entry.name] = Array.isArray(entry.optIns)
      ? entry.optIns.filter(v => typeof v === 'string')
      : []
  }
  return out
}

/**
 * The rule types the law requires effective on a repo's main, given its
 * roster optIns: `deletion` always; `non_fast_forward` unless the repo
 * carries {@link SQUASH_HISTORY_OPT_IN}. Pull-request rules are deliberately
 * absent — push-to-main is doctrine. Pure; exported for tests.
 */
export function requiredRuleTypes(
  optIns: readonly string[],
): readonly string[] {
  const rules = [RULE_DELETION]
  if (!optIns.includes(SQUASH_HISTORY_OPT_IN)) {
    rules.push(RULE_NON_FAST_FORWARD)
  }
  return rules
}

/**
 * Parse the `gh api …/rules/branches/main` jq projection (see
 * `ghEffectiveRuleTypes`) into the effective rule-type list, or undefined
 * when the payload is not the expected array shape — an unreadable answer
 * must yield no findings, not a crash or a fabricated one. Pure; exported
 * for tests.
 */
export function parseEffectiveRuleTypes(json: string): string[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) {
    return undefined
  }
  const out: string[] = []
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i]
    if (typeof entry === 'string') {
      out.push(entry)
    }
  }
  return out
}

/**
 * The findings for one repo: each required rule type (per its optIns) that
 * is NOT among the effective rules on main. The effective list is what
 * GitHub aggregates across org + repo rulesets after enforcement filtering,
 * so a disabled ruleset's rules are correctly absent here. An undefined list
 * (unreadable read) yields NO findings. Pure; exported for tests.
 */
export function branchRuleFindings(
  repo: FleetRepo,
  optIns: readonly string[],
  effective: readonly string[] | undefined,
): RuleFinding[] {
  if (!effective) {
    return []
  }
  const required = requiredRuleTypes(optIns)
  const out: RuleFinding[] = []
  for (let i = 0, { length } = required; i < length; i += 1) {
    const rule = required[i]!
    if (!effective.includes(rule)) {
      out.push({ repo: repo.name, owner: repo.owner, rule })
    }
  }
  return out.toSorted((a, b) => a.rule.localeCompare(b.rule))
}

/**
 * The remediations the law prescribes for a finding set: one action per
 * affected repo, carrying that repo's FULL canonical rule set (not just the
 * missing rule — the managed ruleset is declarative, so a repo missing only
 * `deletion` still converges to deletion + non_fast_forward when its optIns
 * demand both). Pure; exported for tests so the plan — what `--fix` will
 * DO — is provable without gh.
 */
export function planFixes(
  findings: readonly RuleFinding[],
  optInsByRepo: Readonly<Record<string, readonly string[]>>,
): FixAction[] {
  const out: FixAction[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const key = `${f.owner}/${f.repo}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push({
      repo: f.repo,
      owner: f.owner,
      rules: requiredRuleTypes(optInsByRepo[f.repo] ?? []),
    })
  }
  return out
}

/**
 * The canonical body of the managed ruleset — the exact JSON `--fix` POSTs
 * (create) or PATCHes (converge): active enforcement, `~DEFAULT_BRANCH`
 * include so a future default-branch rename stays covered, and exactly the
 * prescribed rule types. Pure; exported for tests.
 */
export function rulesetPayload(rules: readonly string[]): {
  readonly name: string
  readonly target: string
  readonly enforcement: string
  readonly conditions: {
    readonly ref_name: {
      readonly include: readonly string[]
      readonly exclude: readonly string[]
    }
  }
  readonly rules: ReadonlyArray<{ readonly type: string }>
} {
  const ruleObjects: Array<{ readonly type: string }> = []
  for (let i = 0, { length } = rules; i < length; i += 1) {
    ruleObjects.push({ type: rules[i]! })
  }
  return {
    name: MANAGED_RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: {
      ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] },
    },
    rules: ruleObjects,
  }
}

/**
 * Locate the managed ruleset in a `gh api …/rulesets` jq projection (see
 * `applyFix`): its numeric id when a Repository-sourced ruleset named
 * {@link MANAGED_RULESET_NAME} exists, `'absent'` when the list is readable
 * but carries none (POST a fresh one), undefined when the payload is
 * unreadable (fix must abort — POSTing blind could duplicate, PATCHing blind
 * could hit the wrong ruleset). Only Repository-sourced entries match: an
 * org or enterprise ruleset is never ours to manage. Pure; exported for
 * tests.
 */
export function parseManagedRulesetId(
  json: string,
): number | 'absent' | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) {
    return undefined
  }
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i] as {
      id?: unknown | undefined
      name?: unknown | undefined
      source_type?: unknown | undefined
    }
    if (
      entry?.name === MANAGED_RULESET_NAME &&
      entry?.source_type === 'Repository' &&
      typeof entry?.id === 'number'
    ) {
      return entry.id
    }
  }
  return 'absent'
}

// True when `gh` is installed and authenticated — the precondition for the reads.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  return spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
}

// Thin sync `gh` shell-out; stdout on success, undefined on any failure. The
// optional `input` feeds a JSON body to `gh api --input -`.
function gh(
  args: readonly string[],
  input?: string | undefined,
): string | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; reads and fixes apply sequentially inline.
  const result = spawnSync('gh', args as string[], {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  })
  return result.status === 0 ? String(result.stdout ?? '') : undefined
}

// One repo's effective rule types on main, or undefined when the read fails
// (missing repo / network / auth) — member-repos-resolve owns missing repos.
function ghEffectiveRuleTypes(repo: FleetRepo): string[] | undefined {
  const out = gh([
    'api',
    `repos/${repo.owner}/${repo.name}/rules/branches/main`,
    '--jq',
    '[.[].type]',
  ])
  return out === undefined ? undefined : parseEffectiveRuleTypes(out)
}

/**
 * Apply one remediation: converge the managed ruleset to the canonical
 * shape. Returns true when GitHub accepted the write, false when it could
 * not be applied (the caller re-sweeps and the residual finding fails the
 * run). Idempotent: an existing `fleet-main-protection` ruleset is PATCHed
 * in place — never duplicated — and no other ruleset is ever touched.
 */
function applyFix(fix: FixAction): boolean {
  const base = `repos/${fix.owner}/${fix.repo}/rulesets`
  const listing = gh([
    'api',
    base,
    '--jq',
    '[.[] | {id: .id, name: .name, source_type: .source_type}]',
  ])
  const managedId =
    listing === undefined ? undefined : parseManagedRulesetId(listing)
  if (managedId === undefined) {
    logger.warn(
      `  ${fix.repo}: NOT fixed — ruleset list unreadable; writing blind could duplicate or hit the wrong ruleset`,
    )
    return false
  }
  const body = JSON.stringify(rulesetPayload(fix.rules))
  const written =
    managedId === 'absent'
      ? gh(['api', '-X', 'POST', base, '--input', '-'], body)
      : gh(['api', '-X', 'PATCH', `${base}/${managedId}`, '--input', '-'], body)
  if (written === undefined) {
    logger.warn(
      `  ${fix.repo}: ${managedId === 'absent' ? 'POST' : 'PATCH'} of ${MANAGED_RULESET_NAME} failed`,
    )
    return false
  }
  logger.log(
    `  ${fix.repo}: ${MANAGED_RULESET_NAME} ${managedId === 'absent' ? 'created' : 'converged'} — active, rules: ${fix.rules.join(', ')}`,
  )
  return true
}

function sweep(
  repos: readonly FleetRepo[],
  optInsByRepo: Readonly<Record<string, readonly string[]>>,
): RuleFinding[] {
  const findings: RuleFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    findings.push(
      ...branchRuleFindings(
        repo,
        optInsByRepo[repo.name] ?? [],
        ghEffectiveRuleTypes(repo),
      ),
    )
  }
  return findings
}

export function main(): void {
  // Release/CI tier only — a fleet-wide network sweep, never the interactive
  // inner loop. check.mts sets FLEET_CHECK_RELEASE under --release / CI.
  // `--fix` is an explicit operator invocation, so it runs on any tier.
  const fixMode = process.argv.includes('--fix')
  if (!process.env['FLEET_CHECK_RELEASE'] && !fixMode) {
    return
  }
  // Wheelhouse-only: the roster cascades fleet-wide for the hook membership
  // law, so every member carries it — without this gate every member's
  // release CI would re-run the same fleet-wide sweep.
  if (!OWNS_RELOCATED_TESTS) {
    logger.log(
      'main-branch-rules-are-enforced: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'main-branch-rules-are-enforced: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'main-branch-rules-are-enforced: skipped (gh unauthenticated — cannot audit branch rules).',
    )
    return
  }
  let repos: FleetRepo[]
  let optInsByRepo: Record<string, readonly string[]>
  try {
    const raw = readFileSync(reposPath, 'utf8')
    repos = parseFleetRepos(raw)
    optInsByRepo = parseFleetOptIns(raw)
  } catch (e) {
    logger.warn(
      `main-branch-rules-are-enforced: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage(
        'main-branch-rules-are-enforced',
        selection.unmatched,
      ),
    )
    process.exitCode = 1
    return
  }
  repos = selection.selected
  let findings = sweep(repos, optInsByRepo)
  if (fixMode && findings.length > 0) {
    logger.log(
      `main-branch-rules-are-enforced: applying the law to ${findings.length} finding(s)…`,
    )
    const fixes = planFixes(findings, optInsByRepo)
    for (let i = 0, { length } = fixes; i < length; i += 1) {
      applyFix(fixes[i]!)
    }
    // Re-sweep so success is measured against GitHub's answer, never the
    // fixer's own belief that it succeeded.
    findings = sweep(repos, optInsByRepo)
  }
  if (findings.length === 0) {
    logger.log(
      'main-branch-rules-are-enforced: OK — every audited main carries its required effective rules.',
    )
    return
  }
  logger.warn(
    `main-branch-rules-are-enforced: ${findings.length} rule finding(s) — an unprotected main accepts force-push and deletion. Remediate with: node scripts/fleet/check/main-branch-rules-are-enforced.mts --fix`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.warn(
      f.rule === RULE_DELETION
        ? `  ${f.repo}: no effective deletion rule — main can be deleted by anyone with push access`
        : `  ${f.repo}: no effective non_fast_forward rule — main accepts force-push (repo has no ${SQUASH_HISTORY_OPT_IN} opt-in)`,
    )
  }
  if (MODE === 'strict') {
    process.exitCode = 1
  }
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main()
}
/* c8 ignore stop */
