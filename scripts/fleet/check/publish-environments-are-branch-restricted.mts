#!/usr/bin/env node
/**
 * @file Assertion: every fleet member's publish-shaped GitHub environment
 *   (`npm-publish`, `cargo-publish`, `github-release`) carries a deployment
 *   branch policy, and the pre-rename legacy names (`publish`, `release`) do
 *   not exist at all. npm/cargo trusted publishing authorizes on repo +
 *   workflow path + ENVIRONMENT NAME — never a branch — and
 *   `workflow_dispatch` runs the workflow file from the dispatched ref, so
 *   any in-workflow ref guard travels with an attacker's branch and can be
 *   edited out there. The environment's deployment-branch policy is the one
 *   control GitHub enforces server-side regardless of ref content; with it
 *   null, a dispatch from ANY reachable ref can publish (socket-cli #1428:
 *   `dist-tag` defaulted to `latest`, so any branch could overwrite
 *   `socket@latest`). Found fleet-wide on 2026-07-28 — 13 members carried an
 *   unrestricted `npm-publish` — and burned to zero the same day, which is
 *   why MODE is strict from day one.
 *   Legacy names are findings in their own right: they are the pre-rename
 *   environments (four survived the `publish` → `npm-publish` rename as
 *   unrestricted second doors), and a registry-side trusted-publisher config
 *   that still names one would mint tokens through it unnoticed.
 *   Environments are repo SETTINGS — invisible to the cascade, so this drift
 *   class needs its own ratchet; a fresh env is also born unrestricted, so a
 *   member adopting a publish workflow regresses silently without this.
 *   THE LAW IS THE FIX: `--fix` applies the codified policy itself —
 *   `allowedBranches()` per repo (main everywhere; socket-cli adds v1.x for
 *   its maintenance-line publishes) — restricting unrestricted publish
 *   environments idempotently and deleting legacy ones (refusing when the
 *   environment still holds secrets/variables, which must be audited by a
 *   human first). The 2026-07-28 burn-down was hand-run `gh api`; this flag
 *   is that remediation as code, so the fix is reproducible and never
 *   drifts from the assertion.
 *   For each roster repo it reads `gh api repos/<owner>/<name>/environments`;
 *   an unreadable read — 404 repo, network, auth — yields NO findings; only a
 *   concrete unrestricted/legacy environment counts, so the audit never
 *   invents a finding it cannot stand behind (member-repos-resolve owns
 *   missing repos). Skips CLEANLY — never false-green — off the release/CI
 *   tier (FLEET_CHECK_RELEASE), in a member checkout (wheelhouse-only, gated
 *   on template/base ownership), with no fleet-repos.json (a fresh clone
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

// Strict from day one: the fleet was burned to zero unrestricted publish
// environments on 2026-07-28, so a finding here is fresh drift, never a
// known-open backlog item (contrast member-ci-fires-on-push's report mode).
const MODE: 'report' | 'strict' = 'strict'

/**
 * Environment names that gate a publish/release. The fleet convention is
 * exactly these three; anything publish-shaped under another name should be
 * renamed, not added here.
 */
export const PUBLISH_ENV_NAMES: readonly string[] = [
  'cargo-publish',
  'github-release',
  'npm-publish',
]

/**
 * Pre-rename environment names that must not exist at all — each survived a
 * rename once as an unrestricted second door (`publish` on four members,
 * `release` on a since-retired member), and a registry-side trusted-publisher
 * config can still reference them by name.
 */
export const LEGACY_ENV_NAMES: readonly string[] = ['publish', 'release']

/**
 * The default deployment-branch law: publishes dispatch from main, nowhere
 * else. Per-repo exceptions live in {@link ALLOWED_BRANCH_EXCEPTIONS}.
 */
export const DEFAULT_ALLOWED_BRANCHES: readonly string[] = ['main']

/**
 * Per-repo branch-law exceptions. socket-cli publishes its v1.x maintenance
 * line from the `v1.x` branch (socket-cli #1428 — the in-repo dist-tag guard
 * keeps `latest` main-only; this policy keeps every OTHER ref out entirely).
 * An entry here is the WHOLE allowed list for that repo, not an addition.
 */
export const ALLOWED_BRANCH_EXCEPTIONS: Readonly<
  Record<string, readonly string[]>
> = {
  'socket-cli': ['main', 'v1.x'],
}

/**
 * The branches a repo's publish environments may deploy from — the codified
 * law `--fix` applies. Pure; exported for tests.
 */
export function allowedBranches(repo: string): readonly string[] {
  return ALLOWED_BRANCH_EXCEPTIONS[repo] ?? DEFAULT_ALLOWED_BRANCHES
}

/**
 * What one environment read yields: its name and whether ANY deployment
 * branch policy is set (`deployment_branch_policy` non-null — protected
 * branches or a custom list; null is GitHub's "No restriction" default).
 */
export interface EnvProbe {
  readonly name: string
  readonly restricted: boolean
}

export interface EnvFinding {
  readonly repo: string
  readonly owner: string
  readonly env: string
  readonly kind: 'legacy' | 'unrestricted'
}

/**
 * One remediation the law prescribes for a finding: restrict an unrestricted
 * publish environment to {@link allowedBranches}, or delete a legacy one.
 */
export interface FixAction {
  readonly repo: string
  readonly owner: string
  readonly env: string
  readonly action: 'delete' | 'restrict'
  readonly branches: readonly string[]
}

/**
 * Parse the `gh api …/environments` jq projection (see
 * `ghRepoEnvironments`) into probes, or undefined when the payload is not
 * the expected array shape — an unreadable answer must yield no findings,
 * not a crash or a fabricated one. Pure; exported for tests.
 */
export function parseEnvProbes(json: string): EnvProbe[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) {
    return undefined
  }
  const out: EnvProbe[] = []
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i] as {
      name?: unknown | undefined
      restricted?: unknown | undefined
    }
    if (typeof entry?.name !== 'string') {
      continue
    }
    out.push({ name: entry.name, restricted: entry.restricted === true })
  }
  return out
}

/**
 * The findings for one repo's environments: publish-shaped names with no
 * branch policy (`unrestricted`) and pre-rename names existing at all
 * (`legacy` — flagged even when restricted; the name itself is the door).
 * An undefined probe list (unreadable query) yields NO findings. Pure;
 * exported for tests.
 */
export function environmentFindings(
  repo: FleetRepo,
  envs: readonly EnvProbe[] | undefined,
): EnvFinding[] {
  if (!envs) {
    return []
  }
  const out: EnvFinding[] = []
  for (let i = 0, { length } = envs; i < length; i += 1) {
    const env = envs[i]!
    if (LEGACY_ENV_NAMES.includes(env.name)) {
      out.push({
        repo: repo.name,
        owner: repo.owner,
        env: env.name,
        kind: 'legacy',
      })
    } else if (PUBLISH_ENV_NAMES.includes(env.name) && !env.restricted) {
      out.push({
        repo: repo.name,
        owner: repo.owner,
        env: env.name,
        kind: 'unrestricted',
      })
    }
  }
  return out.toSorted((a, b) =>
    a.repo === b.repo
      ? a.env.localeCompare(b.env)
      : a.repo.localeCompare(b.repo),
  )
}

/**
 * The remediations the law prescribes for a finding set: `unrestricted` →
 * restrict to {@link allowedBranches}; `legacy` → delete. Pure; exported for
 * tests so the plan — what `--fix` will DO — is provable without gh.
 */
export function planFixes(findings: readonly EnvFinding[]): FixAction[] {
  const out: FixAction[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    out.push({
      repo: f.repo,
      owner: f.owner,
      env: f.env,
      action: f.kind === 'legacy' ? 'delete' : 'restrict',
      branches: f.kind === 'legacy' ? [] : allowedBranches(f.repo),
    })
  }
  return out
}

// True when `gh` is installed and authenticated — the precondition for the reads.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  return spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
}

// Thin sync `gh` shell-out; stdout on success, undefined on any failure.
function gh(args: readonly string[]): string | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; reads and fixes apply sequentially inline.
  const result = spawnSync('gh', args as string[], { encoding: 'utf8' })
  return result.status === 0 ? String(result.stdout ?? '') : undefined
}

// One repo's environment probes, or undefined when the query fails (missing
// repo / network / auth) — member-repos-resolve owns missing repos.
function ghRepoEnvironments(repo: FleetRepo): EnvProbe[] | undefined {
  const out = gh([
    'api',
    `repos/${repo.owner}/${repo.name}/environments`,
    '--jq',
    '[.environments[] | {name: .name, restricted: (.deployment_branch_policy != null)}]',
  ])
  return out === undefined ? undefined : parseEnvProbes(out)
}

// Integer body of a gh read (secret/variable counts), or undefined on any
// failure — an unreadable count must fail SAFE (treat as occupied).
function ghCount(path: string): number | undefined {
  const out = gh(['api', path, '--jq', '.total_count'])
  if (out === undefined) {
    return undefined
  }
  const n = Number.parseInt(out.trim(), 10)
  return Number.isNaN(n) ? undefined : n
}

/**
 * Apply one remediation. Returns true when the environment now matches the
 * law, false when it could not be brought to match (the caller re-sweeps and
 * the residual finding fails the run).
 *
 * - `restrict` is idempotent: PUT the custom policy, then add only the allowed
 *   branches the environment does not already carry.
 * - `delete` refuses when the environment still holds secrets or variables (or
 *   the counts are unreadable) — destroying stored credentials is a human
 *   decision, not a fixer's.
 */
function applyFix(fix: FixAction): boolean {
  const envPath = `repos/${fix.owner}/${fix.repo}/environments/${fix.env}`
  if (fix.action === 'delete') {
    const secrets = ghCount(`${envPath}/secrets`)
    const variables = ghCount(`${envPath}/variables`)
    if (secrets !== 0 || variables !== 0) {
      logger.warn(
        `  ${fix.repo}/${fix.env}: NOT deleted — environment holds secrets/variables (or counts unreadable); audit and delete by hand`,
      )
      return false
    }
    if (gh(['api', '-X', 'DELETE', envPath]) === undefined) {
      logger.warn(`  ${fix.repo}/${fix.env}: delete failed`)
      return false
    }
    logger.log(`  ${fix.repo}/${fix.env}: legacy environment deleted`)
    return true
  }
  const put = gh([
    'api',
    '-X',
    'PUT',
    envPath,
    '-F',
    'deployment_branch_policy[protected_branches]=false',
    '-F',
    'deployment_branch_policy[custom_branch_policies]=true',
  ])
  if (put === undefined) {
    logger.warn(`  ${fix.repo}/${fix.env}: policy PUT failed`)
    return false
  }
  const existingRaw = gh([
    'api',
    `${envPath}/deployment-branch-policies`,
    '--jq',
    '[.branch_policies[].name]',
  ])
  let existing: string[] = []
  try {
    const parsed: unknown = JSON.parse(existingRaw ?? '[]')
    existing = Array.isArray(parsed)
      ? parsed.filter(v => typeof v === 'string')
      : []
  } catch {
    existing = []
  }
  let ok = true
  for (let i = 0, { length } = fix.branches; i < length; i += 1) {
    const branch = fix.branches[i]!
    if (existing.includes(branch)) {
      continue
    }
    const post = gh([
      'api',
      '-X',
      'POST',
      `${envPath}/deployment-branch-policies`,
      '-f',
      `name=${branch}`,
      '-f',
      'type=branch',
    ])
    if (post === undefined) {
      logger.warn(`  ${fix.repo}/${fix.env}: adding branch ${branch} failed`)
      ok = false
    }
  }
  if (ok) {
    logger.log(
      `  ${fix.repo}/${fix.env}: restricted to ${fix.branches.join(', ')}`,
    )
  }
  return ok
}

function sweep(repos: readonly FleetRepo[]): EnvFinding[] {
  const findings: EnvFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    findings.push(...environmentFindings(repo, ghRepoEnvironments(repo)))
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
      'publish-environments-are-branch-restricted: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'publish-environments-are-branch-restricted: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'publish-environments-are-branch-restricted: skipped (gh unauthenticated — cannot audit environments).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `publish-environments-are-branch-restricted: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage(
        'publish-environments-are-branch-restricted',
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
      `publish-environments-are-branch-restricted: applying the law to ${findings.length} finding(s)…`,
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
      'publish-environments-are-branch-restricted: OK — every audited publish environment carries a branch policy and no legacy names exist.',
    )
    return
  }
  logger.warn(
    `publish-environments-are-branch-restricted: ${findings.length} environment finding(s) — an unrestricted publish environment lets a dispatch from ANY ref publish. Remediate with: node scripts/fleet/check/publish-environments-are-branch-restricted.mts --fix`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.warn(
      f.kind === 'legacy'
        ? `  ${f.repo}/${f.env}: legacy pre-rename environment — must be deleted; audit the registry-side trusted-publisher config for references to it`
        : `  ${f.repo}/${f.env}: no deployment branch policy — must be restricted to ${allowedBranches(f.repo).join(', ')}`,
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
