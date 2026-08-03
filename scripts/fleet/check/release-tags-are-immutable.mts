#!/usr/bin/env node
/**
 * @file Assertion: every fleet member's version tags (`v*`) are IMMUTABLE —
 *   a tag-target ruleset makes `non_fast_forward` (no moving) and `deletion`
 *   (no deleting) effective on `refs/tags/v*`. Found fleet-wide on
 *   2026-07-28: a settings audit turned up ZERO tag-target rulesets on any
 *   fleet repo, so anyone with push access can move or delete a `v*` release
 *   tag — and tags trigger the publish/release workflows — which is why MODE
 *   is strict from day one.
 *   Tag CREATION is deliberately NOT restricted: the fleet's release flows
 *   create tags (a local `--approve` promote pushes them), and a `creation`
 *   rule without bypass actors would brick every release. Immutability of
 *   tags that already exist is the whole law.
 *   The read is `gh api repos/<owner>/<name>/rulesets` (list) plus a detail
 *   GET per tag-target ruleset id — NOT the rules-for-ref endpoint: that
 *   endpoint is branch-oriented (`rules/branches/<branch>`) and its tags
 *   variant 404s, verified live on 2026-07-28. The list omits `conditions`
 *   and `rules` (verified against socket-cli's live rulesets), so the detail
 *   GET is where enforcement, ref includes, and rule types actually come
 *   from. A repo passes when SOME single tag-target, enforcement-active
 *   ruleset whose ref_name.include covers `refs/tags/v*` (literal pattern,
 *   or `~ALL`) carries BOTH rule types — coverage is judged per-ruleset, the
 *   same shape `--fix` maintains, never unioned across rulesets. An
 *   unreadable answer — 404 repo, network, auth, an unreadable detail —
 *   yields NO findings; only a concrete readable ruleset picture counts, so
 *   the audit never invents a finding it cannot stand behind
 *   (member-repos-resolve owns missing repos).
 *   THE LAW IS THE FIX: `--fix` manages exactly ONE repo-level ruleset named
 *   `fleet-tag-protection` (target tag, enforcement active, include
 *   `refs/tags/v*`, rules deletion + non_fast_forward). If a ruleset with
 *   that name exists it is PATCHed to the canonical shape; if missing it is
 *   POSTed. No OTHER ruleset is ever touched — org rulesets and the sibling
 *   `fleet-main-protection` branch ruleset are out of scope. After fixing,
 *   the check re-sweeps so success is measured from GitHub's answer, never
 *   the fixer's belief.
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

// Strict from day one: the 2026-07-28 audit found ZERO tag-target rulesets
// fleet-wide, so a finding here is a real open door — a movable, deletable
// release tag that feeds the publish workflows — never a known-open backlog
// item (contrast member-ci-fires-on-push's report mode).
const MODE: 'report' | 'strict' = 'strict'

/**
 * One of the two rules that must be effective on version tags: nobody
 * deletes a published release tag.
 */
export const RULE_DELETION = 'deletion'

/**
 * The other required rule: nobody force-moves a published release tag to a
 * different commit.
 */
export const RULE_NON_FAST_FORWARD = 'non_fast_forward'

/**
 * The full law for every fleet repo's version tags. `creation` is
 * deliberately ABSENT — release flows push new `v*` tags, and a creation
 * rule without bypass actors would brick them (see @file).
 */
export const REQUIRED_TAG_RULES: readonly string[] = [
  RULE_DELETION,
  RULE_NON_FAST_FORWARD,
]

/**
 * The ref_name.include pattern the managed ruleset targets, and the literal
 * pattern the audit credits as covering version tags.
 */
export const VERSION_TAG_INCLUDE = 'refs/tags/v*'

/**
 * GitHub's all-refs include sentinel — also credited as covering `v*` tags.
 */
export const ALL_REFS_INCLUDE = '~ALL'

/**
 * The ONE repo-level ruleset `--fix` manages. Anything else — org rulesets,
 * the sibling `fleet-main-protection` branch ruleset, pre-existing repo
 * rulesets under other names — is never created, patched, or deleted by
 * this check.
 */
export const MANAGED_RULESET_NAME = 'fleet-tag-protection'

export interface RuleFinding {
  readonly repo: string
  readonly owner: string
  readonly rule: string
}

/**
 * One remediation the law prescribes: bring the managed tag ruleset on a
 * repo to the canonical shape. The rules are the same for every repo (no
 * opt-in varies them), so the action is just the repo coordinate.
 */
export interface FixAction {
  readonly repo: string
  readonly owner: string
}

/**
 * The audit's projection of one ruleset detail GET: what it targets, whether
 * it is enforced, which refs it includes, and which rule types it carries.
 */
export interface TagRulesetDetail {
  readonly target: string
  readonly enforcement: string
  readonly include: readonly string[]
  readonly ruleTypes: readonly string[]
}

/**
 * Parse the `gh api …/rulesets` jq projection (see `ghTagRulesetDetails`)
 * into the ids of tag-target rulesets, or undefined when the payload is not
 * the expected shape — an unreadable answer must yield no findings, not a
 * crash or a fabricated one. Strict where it matters: a tag-target entry
 * with an ill-typed id makes the whole read unreadable, because silently
 * dropping a possibly-protective ruleset could invent a finding. Non-tag
 * entries are irrelevant and skipped. Pure; exported for tests.
 */
export function parseTagRulesetIds(json: string): number[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) {
    return undefined
  }
  const out: number[] = []
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i] as {
      id?: unknown | undefined
      target?: unknown | undefined
    }
    if (entry?.target !== 'tag') {
      continue
    }
    if (typeof entry?.id !== 'number') {
      return undefined
    }
    out.push(entry.id)
  }
  return out
}

/**
 * Parse one ruleset detail GET (raw JSON, no jq — the payload shape was
 * verified live against socket-cli's rulesets on 2026-07-28) into a
 * {@link TagRulesetDetail}, or undefined when the payload is not a readable
 * ruleset object. Missing `conditions`/`rules` degrade to empty lists — a
 * ruleset with no includes or no rules genuinely protects nothing — but a
 * missing `target` or `enforcement` means the read cannot be trusted. Pure;
 * exported for tests.
 */
export function parseRulesetDetail(json: string): TagRulesetDetail | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }
  const obj = data as {
    target?: unknown | undefined
    enforcement?: unknown | undefined
    conditions?: unknown | undefined
    rules?: unknown | undefined
  }
  if (typeof obj.target !== 'string' || typeof obj.enforcement !== 'string') {
    return undefined
  }
  const includeRaw = (
    obj.conditions as
      | { ref_name?: { include?: unknown | undefined } | undefined }
      | undefined
  )?.ref_name?.include
  const include: string[] = []
  if (Array.isArray(includeRaw)) {
    for (let i = 0, { length } = includeRaw; i < length; i += 1) {
      const v = includeRaw[i]
      if (typeof v === 'string') {
        include.push(v)
      }
    }
  }
  const ruleTypes: string[] = []
  if (Array.isArray(obj.rules)) {
    for (let i = 0, { length } = obj.rules; i < length; i += 1) {
      const t = (obj.rules[i] as { type?: unknown | undefined })?.type
      if (typeof t === 'string') {
        ruleTypes.push(t)
      }
    }
  }
  return {
    target: obj.target,
    enforcement: obj.enforcement,
    include,
    ruleTypes,
  }
}

/**
 * Whether a ruleset's ref_name.include covers version tags: the literal
 * {@link VERSION_TAG_INCLUDE} pattern or GitHub's {@link ALL_REFS_INCLUDE}
 * sentinel. Deliberately literal — modeling GitHub's full fnmatch dialect
 * risks crediting a pattern GitHub reads differently, so a broader glob
 * (e.g. `refs/tags/*`) conservatively reads as NOT covering; `--fix`
 * converges the managed ruleset, which then passes on its own merits. Pure;
 * exported for tests.
 */
export function includeCoversVersionTags(include: readonly string[]): boolean {
  return (
    include.includes(VERSION_TAG_INCLUDE) || include.includes(ALL_REFS_INCLUDE)
  )
}

/**
 * The findings for one repo: each required rule type missing from the
 * best-covering QUALIFYING ruleset — target `tag`, enforcement `active`
 * (disabled and evaluate rulesets protect nothing), include covering `v*`
 * tags. The law wants ONE ruleset carrying both rules (the managed shape),
 * so coverage is never unioned across rulesets; judging against the
 * best-covering one means a half-configured ruleset reports only its
 * genuinely missing rule. An undefined list (unreadable read) yields NO
 * findings. Pure; exported for tests.
 */
export function tagRuleFindings(
  repo: FleetRepo,
  rulesets: readonly TagRulesetDetail[] | undefined,
): RuleFinding[] {
  if (!rulesets) {
    return []
  }
  let best: readonly string[] = []
  let bestCount = -1
  for (let i = 0, { length } = rulesets; i < length; i += 1) {
    const rs = rulesets[i]!
    if (
      rs.target !== 'tag' ||
      rs.enforcement !== 'active' ||
      !includeCoversVersionTags(rs.include)
    ) {
      continue
    }
    let count = 0
    for (let j = 0, { length: rlen } = REQUIRED_TAG_RULES; j < rlen; j += 1) {
      if (rs.ruleTypes.includes(REQUIRED_TAG_RULES[j]!)) {
        count += 1
      }
    }
    if (count > bestCount) {
      bestCount = count
      best = rs.ruleTypes
    }
  }
  const out: RuleFinding[] = []
  for (let i = 0, { length } = REQUIRED_TAG_RULES; i < length; i += 1) {
    const rule = REQUIRED_TAG_RULES[i]!
    if (!best.includes(rule)) {
      out.push({ repo: repo.name, owner: repo.owner, rule })
    }
  }
  return out.toSorted((a, b) => a.rule.localeCompare(b.rule))
}

/**
 * The remediations the law prescribes for a finding set: one action per
 * affected repo. The managed ruleset is declarative and identical
 * everywhere, so a repo missing only one rule still converges to the full
 * canonical shape. Pure; exported for tests so the plan — what `--fix` will
 * DO — is provable without gh.
 */
export function planFixes(findings: readonly RuleFinding[]): FixAction[] {
  const out: FixAction[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const key = `${f.owner}/${f.repo}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push({ repo: f.repo, owner: f.owner })
  }
  return out
}

/**
 * The canonical body of the managed ruleset — the exact JSON `--fix` POSTs
 * (create) or PATCHes (converge): active enforcement, `refs/tags/v*`
 * include, exactly the two prescribed rule types, and NO `creation` rule
 * (see @file — release flows push tags). Pure; exported for tests.
 */
export function rulesetPayload(): {
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
  for (let i = 0, { length } = REQUIRED_TAG_RULES; i < length; i += 1) {
    ruleObjects.push({ type: REQUIRED_TAG_RULES[i]! })
  }
  return {
    name: MANAGED_RULESET_NAME,
    target: 'tag',
    enforcement: 'active',
    conditions: {
      ref_name: { include: [VERSION_TAG_INCLUDE], exclude: [] },
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

// One repo's tag-target ruleset details, or undefined when ANY read fails —
// list or detail — because a partial picture could invent a finding the
// audit cannot stand behind (member-repos-resolve owns missing repos).
function ghTagRulesetDetails(repo: FleetRepo): TagRulesetDetail[] | undefined {
  const base = `repos/${repo.owner}/${repo.name}/rulesets`
  const listing = gh([
    'api',
    base,
    '--jq',
    '[.[] | {id: .id, target: .target}]',
  ])
  const ids = listing === undefined ? undefined : parseTagRulesetIds(listing)
  if (ids === undefined) {
    return undefined
  }
  const details: TagRulesetDetail[] = []
  for (let i = 0, { length } = ids; i < length; i += 1) {
    const raw = gh(['api', `${base}/${ids[i]}`])
    const detail = raw === undefined ? undefined : parseRulesetDetail(raw)
    if (detail === undefined) {
      return undefined
    }
    details.push(detail)
  }
  return details
}

/**
 * Apply one remediation: converge the managed tag ruleset to the canonical
 * shape. Returns true when GitHub accepted the write, false when it could
 * not be applied (the caller re-sweeps and the residual finding fails the
 * run). Idempotent: an existing `fleet-tag-protection` ruleset is PATCHed
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
  const body = JSON.stringify(rulesetPayload())
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
    `  ${fix.repo}: ${MANAGED_RULESET_NAME} ${managedId === 'absent' ? 'created' : 'converged'} — active, ${VERSION_TAG_INCLUDE}, rules: ${REQUIRED_TAG_RULES.join(', ')}`,
  )
  return true
}

function sweep(repos: readonly FleetRepo[]): RuleFinding[] {
  const findings: RuleFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    findings.push(...tagRuleFindings(repo, ghTagRulesetDetails(repo)))
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
      'release-tags-are-immutable: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'release-tags-are-immutable: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'release-tags-are-immutable: skipped (gh unauthenticated — cannot audit tag rulesets).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `release-tags-are-immutable: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage(
        'release-tags-are-immutable',
        selection.unmatched,
      ),
    )
    process.exitCode = 1
    return
  }
  repos = selection.selected
  let findings = sweep(repos)
  if (fixMode && findings.length > 0) {
    logger.log(
      `release-tags-are-immutable: applying the law to ${findings.length} finding(s)…`,
    )
    const fixes = planFixes(findings)
    for (let i = 0, { length } = fixes; i < length; i += 1) {
      applyFix(fixes[i]!)
    }
    // Re-sweep so success is measured against GitHub's answer, never the
    // fixer's own belief that it succeeded.
    findings = sweep(repos)
  }
  if (findings.length === 0) {
    logger.log(
      'release-tags-are-immutable: OK — every audited repo carries an active tag ruleset making v* tags immutable.',
    )
    return
  }
  logger.warn(
    `release-tags-are-immutable: ${findings.length} rule finding(s) — an unprotected v* tag can be moved or deleted by anyone with push access, and tags feed the publish workflows. Remediate with: node scripts/fleet/check/release-tags-are-immutable.mts --fix`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.warn(
      f.rule === RULE_DELETION
        ? `  ${f.repo}: no active tag ruleset enforces deletion on ${VERSION_TAG_INCLUDE} — release tags can be deleted`
        : `  ${f.repo}: no active tag ruleset enforces non_fast_forward on ${VERSION_TAG_INCLUDE} — release tags can be moved to a different commit`,
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
