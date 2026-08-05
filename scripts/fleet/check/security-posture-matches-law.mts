#!/usr/bin/env node
/**
 * @file Assertion: every fleet repo's GitHub security posture matches
 *   `_shared/security-posture-law.mts` — CodeQL default setup configured with
 *   a SANITISED language set on every public repo, secret scanning and push
 *   protection on there too, vulnerability alerts on everywhere,
 *   `automated-security-fixes` OFF everywhere, and the canonical no-op
 *   `.github/dependabot.yml` in place. The law module carries the incident
 *   narrative and the reasoning; this file is the sweep, the fixer, and the
 *   verdict.
 *   Repo SETTINGS are invisible to the cascade — nothing in any diff shows
 *   that a repo has been scanning nothing for months — so a standing sweep is
 *   the only ratchet they can have. The 2026-08-03 audit that produced the law
 *   found fifteen of sixteen public repos with code scanning not-configured,
 *   the sixteenth (socket-vscode) configured with three conflicting names for
 *   one JavaScript extractor and permanently erroring, secret scanning off on
 *   all sixteen, and nineteen of twenty-six repos with Dependabot's auto-PR
 *   lane still on.
 *   THE LAW IS THE FIX, with two deliberate refusals. `--fix` may PATCH the
 *   default setup with the sanitised languages, PUT `vulnerability-alerts`,
 *   DELETE `automated-security-fixes` (the DELETE verb is the disable), and
 *   PATCH `security_and_analysis` to turn secret scanning + push protection on
 *   for a PUBLIC repo. It must NOT touch `.github/dependabot.yml` — that file
 *   flows through the cascade, and a remote write would be drift the next sync
 *   silently reverts — and it must NOT touch a private or internal repo's
 *   scanning, which is a paid-GHAS budget decision, not a settings bug. Both
 *   refusals log a line naming the owed action. After fixing, the sweep
 *   RE-READS every repo, so success is measured from GitHub's answer and never
 *   from the fixer's belief that it succeeded.
 *   REPORT MODE for now. A new gate has never been green: the fleet is
 *   converged on none of these clauses yet, so promoting this to strict today
 *   would block every open PR fleet-wide. Flip {@link MODE} to `strict` once
 *   the burn-down lands — the member-ci-fires-on-push rollout pattern.
 *   Skips CLEANLY — never false-green — off the release/CI tier
 *   (FLEET_CHECK_RELEASE), in a member checkout (wheelhouse-only, gated on
 *   template/base ownership), with no fleet-repos.json (a fresh clone
 *   mid-bootstrap), or when `gh` is missing or unauthenticated. Every one of
 *   those prints an explicit `skipped (…)` and exits 0, because this must
 *   never fail a local dev run.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'
import {
  parseRepoFilter,
  selectRepos,
  unmatchedSelectorMessage,
} from '../_shared/repo-filter.mts'
import {
  CODEQL_QUERY_SUITE,
  expectedPosture,
  securityPostureFindings,
} from '../_shared/security-posture-law.mts'
import {
  parseAutomatedSecurityFixes,
  parseDefaultSetup,
  parseDependabotYml,
  parseLinguistLanguages,
  parseRepoSecurity,
  parseVulnerabilityAlerts,
  scanPresentLanguages,
} from '../_shared/security-posture-probe.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'

import type {
  ExpectedPosture,
  PostureProbes,
  SecurityPostureFinding,
} from '../_shared/security-posture-law.mts'
import type { GhAnswer } from '../_shared/security-posture-probe.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import type { FleetRepo } from './member-ci-fires-on-push.mts'

const logger = getDefaultLogger()

// Report mode, deliberately. A NEW gate has never been green, and this one is
// red on most of the fleet by construction: promoting it before the burn-down
// would block every open PR on a backlog no single PR can clear. Promotion to
// 'strict' is its own work item, after the fleet converges.
const MODE: 'report' | 'strict' = 'report'

/**
 * One repo's audited posture: what the law wanted, what GitHub said, and the
 * two severities kept apart so an advisory can never fail a run.
 */
export interface RepoPosture {
  readonly advisories: readonly SecurityPostureFinding[]
  readonly expected: ExpectedPosture
  readonly findings: readonly SecurityPostureFinding[]
  readonly owner: string
  readonly repo: string
}

/**
 * What `--fix` will do to one repo, and what it deliberately will not. Every
 * boolean is a single idempotent API call; `refusals` are the owed actions the
 * fixer is not allowed to take.
 */
export interface SecurityFixPlan {
  /**
   * The sanitised language set to PATCH, or undefined to leave the default
   * setup alone.
   */
  readonly codeqlLanguages: readonly string[] | undefined
  readonly disableAutomatedSecurityFixes: boolean
  readonly enableSecretScanning: boolean
  readonly enableVulnerabilityAlerts: boolean
  readonly owner: string
  readonly refusals: readonly string[]
  readonly repo: string
}

/**
 * The body `--fix` PATCHes to `code-scanning/default-setup`. Pure; exported so
 * the exact bytes that would reach GitHub are provable without gh.
 */
export function defaultSetupPayload(languages: readonly string[]): {
  readonly languages: readonly string[]
  readonly query_suite: string
  readonly state: string
} {
  return {
    languages: [...languages],
    query_suite: CODEQL_QUERY_SUITE,
    state: 'configured',
  }
}

/**
 * The body `--fix` PATCHes to `repos/{owner}/{repo}` to turn secret scanning
 * and push protection on. Push protection cannot be enabled without secret
 * scanning, so both go in one call. Pure; exported for tests.
 */
export function secretScanningPayload(): {
  readonly security_and_analysis: {
    readonly secret_scanning: { readonly status: string }
    readonly secret_scanning_push_protection: { readonly status: string }
  }
} {
  return {
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' },
    },
  }
}

/**
 * The remediation for one audited repo. Findings drive it, never advisories —
 * which is how clause `private-scanning-is-advisory` keeps `--fix` off the
 * nine paid-GHAS repos without a visibility test in every branch. Two
 * categories are refused outright and named instead: dependabot.yml drift
 * (cascade-owned) and any scanning change on a non-public repo. Pure;
 * exported so the plan is provable without gh.
 */
export function planRepoFix(posture: RepoPosture): SecurityFixPlan {
  const rules = new Set(posture.findings.map(f => f.rule))
  const refusals: string[] = []
  if (rules.has('dependabot-yml-is-canonical')) {
    refusals.push(
      '.github/dependabot.yml drift — cascade-owned; re-sync from template/base, never write it remotely',
    )
  }
  for (const advisory of posture.advisories) {
    if (advisory.rule === 'private-scanning-is-advisory') {
      refusals.push(
        'code scanning needs paid GHAS on this repo — a budget decision, not a settings fix',
      )
    }
  }
  const wantsCodeScanning =
    rules.has('public-code-scanning-configured') ||
    rules.has('one-js-extractor') ||
    rules.has('languages-match-presence')
  return {
    codeqlLanguages: wantsCodeScanning
      ? posture.expected.codeqlLanguages
      : undefined,
    disableAutomatedSecurityFixes: rules.has(
      'automated-security-fixes-disabled',
    ),
    enableSecretScanning: rules.has('public-secret-scanning-enabled'),
    enableVulnerabilityAlerts: rules.has('vulnerability-alerts-enabled'),
    owner: posture.owner,
    refusals,
    repo: posture.repo,
  }
}

/**
 * True when the plan would issue no API call at all. Pure; exported for tests.
 */
export function isNoOpFix(plan: SecurityFixPlan): boolean {
  return (
    plan.codeqlLanguages === undefined &&
    !plan.disableAutomatedSecurityFixes &&
    !plan.enableSecretScanning &&
    !plan.enableVulnerabilityAlerts
  )
}

// True when `gh` is installed and authenticated — the precondition for every
// read below. A missing binary throws ENOENT into `status: null`, which is
// also not 0, so both offline shapes land in the same clean skip.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  return spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
}

// One `gh` call, exit code and both streams preserved. NEVER piped: for
// vulnerability-alerts and the GHAS 403 the status is the entire answer.
function gh(args: readonly string[], input?: string | undefined): GhAnswer {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; reads and fixes apply sequentially inline.
  const result = spawnSync('gh', args as string[], {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  })
  return {
    ok: result.status === 0,
    stderr: String(result.stderr ?? ''),
    stdout: String(result.stdout ?? ''),
  }
}

// The languages present in a repo, preferring a local sibling clone (which can
// exclude fixtures) and falling back to the Linguist read (which cannot).
function readPresentLanguages(repo: FleetRepo): string[] {
  const local = scanPresentLanguages(
    path.join(path.dirname(REPO_ROOT), repo.name),
  )
  if (local) {
    return local
  }
  const remote = parseLinguistLanguages(
    gh(['api', `repos/${repo.owner}/${repo.name}/languages`]),
  )
  return remote ?? []
}

// Read one repo's whole posture. Every unreadable answer stays undefined and
// therefore yields nothing — see the law's contract on unreadable probes.
function auditRepo(repo: FleetRepo): RepoPosture | undefined {
  const base = `repos/${repo.owner}/${repo.name}`
  const repoProbe = parseRepoSecurity(gh(['api', base]))
  if (!repoProbe?.visibility) {
    // Without a visibility there is no law to apply — member-repos-resolve
    // owns missing repos, so this is silent rather than a finding.
    return undefined
  }
  const expected = expectedPosture({
    presentLanguages: readPresentLanguages(repo),
    visibility: repoProbe.visibility,
  })
  const probes: PostureProbes = {
    automatedSecurityFixes: parseAutomatedSecurityFixes(
      gh(['api', `${base}/automated-security-fixes`]),
    ),
    codeScanning: parseDefaultSetup(
      gh(['api', `${base}/code-scanning/default-setup`]),
    ),
    dependabotYml: parseDependabotYml(
      gh(['api', `${base}/contents/.github/dependabot.yml`]),
    ),
    secretScanning: repoProbe.secretScanning,
    vulnerabilityAlerts: parseVulnerabilityAlerts(
      gh(['api', `${base}/vulnerability-alerts`]),
    ),
  }
  const all = securityPostureFindings(expected, probes)
  return {
    advisories: all.filter(f => f.severity === 'advisory'),
    expected,
    findings: all.filter(f => f.severity === 'finding'),
    owner: repo.owner,
    repo: repo.name,
  }
}

function sweep(repos: readonly FleetRepo[]): RepoPosture[] {
  const out: RepoPosture[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const posture = auditRepo(repos[i]!)
    if (posture) {
      out.push(posture)
    }
  }
  return out
}

// Apply one plan. Each call is idempotent, so a partially-converged repo is
// safe to re-run; the re-sweep, not this function's return, decides success.
function applyFix(plan: SecurityFixPlan): void {
  const base = `repos/${plan.owner}/${plan.repo}`
  const label = `  ${plan.repo}:`
  for (let i = 0, { length } = plan.refusals; i < length; i += 1) {
    logger.log(`${label} NOT fixed — ${plan.refusals[i]!}`)
  }
  if (plan.codeqlLanguages) {
    const body = JSON.stringify(defaultSetupPayload(plan.codeqlLanguages))
    const answer = gh(
      [
        'api',
        '-X',
        'PATCH',
        `${base}/code-scanning/default-setup`,
        '--input',
        '-',
      ],
      body,
    )
    logger.log(
      answer.ok
        ? `${label} code scanning configured — ${plan.codeqlLanguages.join(', ')}`
        : `${label} code-scanning PATCH failed`,
    )
  }
  if (plan.enableVulnerabilityAlerts) {
    const answer = gh(['api', '-X', 'PUT', `${base}/vulnerability-alerts`])
    logger.log(
      answer.ok
        ? `${label} vulnerability alerts enabled`
        : `${label} vulnerability-alerts PUT failed`,
    )
  }
  if (plan.disableAutomatedSecurityFixes) {
    // DELETE is the disable verb for this endpoint — there is no `{enabled:
    // false}` body to PUT.
    const answer = gh([
      'api',
      '-X',
      'DELETE',
      `${base}/automated-security-fixes`,
    ])
    logger.log(
      answer.ok
        ? `${label} automated-security-fixes disabled (alerts still flow)`
        : `${label} automated-security-fixes DELETE failed`,
    )
  }
  if (plan.enableSecretScanning) {
    const answer = gh(
      ['api', '-X', 'PATCH', base, '--input', '-'],
      JSON.stringify(secretScanningPayload()),
    )
    logger.log(
      answer.ok
        ? `${label} secret scanning + push protection enabled`
        : `${label} secret-scanning PATCH failed`,
    )
  }
}

function report(postures: readonly RepoPosture[]): number {
  let findingCount = 0
  for (let i = 0, { length } = postures; i < length; i += 1) {
    const posture = postures[i]!
    for (let j = 0, count = posture.advisories.length; j < count; j += 1) {
      logger.log(
        `  ${posture.repo}: advisory — ${posture.advisories[j]!.detail}`,
      )
    }
    for (let j = 0, count = posture.findings.length; j < count; j += 1) {
      const finding = posture.findings[j]!
      findingCount += 1
      logger.warn(`  ${posture.repo}: [${finding.rule}] ${finding.detail}`)
    }
  }
  return findingCount
}

export function main(): void {
  // Release/CI tier only — a fleet-wide network sweep has no place in the
  // interactive inner loop. `--fix` is an explicit operator invocation, so it
  // runs on any tier.
  const fixMode = process.argv.includes('--fix')
  if (!process.env['FLEET_CHECK_RELEASE'] && !fixMode) {
    return
  }
  if (!OWNS_RELOCATED_TESTS) {
    logger.log(
      'security-posture-matches-law: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'security-posture-matches-law: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'security-posture-matches-law: skipped (gh missing or unauthenticated — cannot audit repo settings).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `security-posture-matches-law: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage(
        'security-posture-matches-law',
        selection.unmatched,
      ),
    )
    process.exitCode = 1
    return
  }
  repos = selection.selected
  let postures = sweep(repos)
  if (fixMode) {
    const plans = postures.map(planRepoFix).filter(p => !isNoOpFix(p))
    if (plans.length > 0) {
      logger.log(
        `security-posture-matches-law: applying the law to ${plans.length} repo(s)…`,
      )
      for (let i = 0, { length } = plans; i < length; i += 1) {
        applyFix(plans[i]!)
      }
      // Re-sweep so the verdict comes from GitHub's fresh answer, never from
      // the fixer's belief that it succeeded.
      postures = sweep(repos)
    }
  }
  const findingCount = report(postures)
  if (findingCount === 0) {
    logger.log(
      `security-posture-matches-law: OK — ${postures.length} repo(s) match the posture law.`,
    )
    return
  }
  logger.warn(
    `security-posture-matches-law: ${findingCount} finding(s) across ${postures.length} repo(s). Remediate with: node scripts/fleet/check/security-posture-matches-law.mts --fix`,
  )
  if (MODE === 'strict') {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'audits every fleet repo GitHub security posture against the fleet posture law',
  help: `Usage: node scripts/fleet/check/security-posture-matches-law.mts [flags]
  --fix          apply the posture law to drifted repos
  --repo <name>  limit the sweep to named repos (repeatable, comma-separable)`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
