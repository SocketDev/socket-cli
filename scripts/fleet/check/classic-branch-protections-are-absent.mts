#!/usr/bin/env node
/*
 * @file Fleet-wide audit: NO fleet repo carries a classic branch protection
 *   rule. The fleet's branch law lives in repository RULESETS
 *   (`fleet-main-protection`, managed by main-branch-rules-are-enforced.mts)
 *   — a classic rule beside them is a second, unmanaged law surface: it can
 *   contradict the ruleset, it carries no Repository-admin bypass, and no
 *   fleet tooling converges it, so whatever it says silently wins forever.
 *   The sweep lists each roster repo's classic rules over GraphQL (REST has
 *   no list-all endpoint for classic protections) and `--fix` deletes each
 *   one by node id. Rulesets are never touched. Fail-open (skip) off the
 *   release tier, on member checkouts, with no roster, or with gh
 *   unauthenticated — same posture as its two ruleset siblings. Usage: node
 *   scripts/fleet/check/classic-branch-protections-are-absent.mts [--fix]
 *   [--quiet] [<repo>…]
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import {
  parseRepoFilter,
  selectRepos,
  unmatchedSelectorMessage,
} from '../_shared/repo-filter.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'
import type { FleetRepo } from './member-ci-fires-on-push.mts'

const logger = getDefaultLogger()

/**
 * One classic branch protection rule on a repo: the GraphQL node id `--fix`
 * deletes by, and the branch pattern it matched for the report.
 */
export interface ClassicProtection {
  readonly id: string
  readonly pattern: string
}

export interface ProtectionFinding {
  readonly repo: string
  readonly owner: string
  readonly id: string
  readonly pattern: string
}

/**
 * Parse the GraphQL nodes projection (see `ghClassicProtections`) into the
 * classic rules on one repo, or undefined when the payload is not the
 * expected shape — an unreadable answer must yield no findings, not a crash
 * or a fabricated one. A node with an ill-typed id makes the whole read
 * unreadable: `--fix` deletes by id, and a half-parsed list invites deleting
 * the wrong thing. Pure; exported for tests.
 */
export function parseClassicProtections(
  json: string,
): ClassicProtection[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) {
    return undefined
  }
  const out: ClassicProtection[] = []
  for (let i = 0, { length } = data; i < length; i += 1) {
    const node = data[i] as {
      id?: unknown | undefined
      pattern?: unknown | undefined
    }
    if (typeof node?.id !== 'string' || !node.id) {
      return undefined
    }
    out.push({
      id: node.id,
      pattern: typeof node.pattern === 'string' ? node.pattern : '',
    })
  }
  return out
}

/**
 * The findings for one repo: one per classic rule present. An undefined list
 * (unreadable read) yields NO findings. Pure; exported for tests.
 */
export function classicProtectionFindings(
  repo: FleetRepo,
  protections: readonly ClassicProtection[] | undefined,
): ProtectionFinding[] {
  if (!protections) {
    return []
  }
  return protections
    .map(p => ({
      repo: repo.name,
      owner: repo.owner,
      id: p.id,
      pattern: p.pattern,
    }))
    .toSorted((a, b) => a.pattern.localeCompare(b.pattern))
}

// gh spawn shared by reads and fixes: stdout on success, undefined on any
// failure (the callers treat unreadable as skip, unfixable as loud residual).
function gh(args: readonly string[]): string | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; reads and fixes apply sequentially inline.
  const result = spawnSync('gh', args as string[], { encoding: 'utf8' })
  return result.status === 0 ? String(result.stdout ?? '') : undefined
}

function ghAuthed(): boolean {
  return gh(['auth', 'status', '--active']) !== undefined
}

// One repo's classic branch protection rules, or undefined when the read
// fails (missing repo / network / auth) — member-repos-resolve owns missing
// repos.
function ghClassicProtections(
  repo: FleetRepo,
): ClassicProtection[] | undefined {
  const out = gh([
    'api',
    'graphql',
    '-f',
    'query=query ListClassicProtections($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { branchProtectionRules(first: 100) { nodes { id pattern } } } }',
    '-f',
    `owner=${repo.owner}`,
    '-f',
    `name=${repo.name}`,
    '--jq',
    '.data.repository.branchProtectionRules.nodes',
  ])
  return out === undefined ? undefined : parseClassicProtections(out)
}

/**
 * Delete one classic rule by node id. Returns true when GitHub accepted the
 * mutation; the caller re-sweeps, so success is measured against GitHub's
 * answer rather than the fixer's belief.
 */
function applyFix(finding: ProtectionFinding): boolean {
  const out = gh([
    'api',
    'graphql',
    '-f',
    'query=mutation DeleteClassicProtection($id: ID!) { deleteBranchProtectionRule(input: { branchProtectionRuleId: $id }) { clientMutationId } }',
    '-f',
    `id=${finding.id}`,
  ])
  if (out === undefined) {
    logger.warn(
      `  ${finding.repo}: NOT fixed — delete of classic rule '${finding.pattern}' failed`,
    )
    return false
  }
  logger.log(
    `  ${finding.repo}: classic rule '${finding.pattern}' deleted — the ruleset law is the one branch-law surface`,
  )
  return true
}

function sweep(repos: readonly FleetRepo[]): ProtectionFinding[] {
  const findings: ProtectionFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    findings.push(
      ...classicProtectionFindings(repo, ghClassicProtections(repo)),
    )
  }
  return findings
}

export function main(): void {
  // Release/CI tier only — a fleet-wide network sweep, never the interactive
  // inner loop. check.mts sets FLEET_CHECK_RELEASE under --release / CI.
  // `--fix` is an explicit operator invocation, so it runs on any tier.
  const fixMode = process.argv.includes('--fix')
  const quiet = process.argv.includes('--quiet')
  if (!process.env['FLEET_CHECK_RELEASE'] && !fixMode) {
    return
  }
  // Wheelhouse-only: without this gate every member's release CI would re-run
  // the same fleet-wide sweep.
  if (!OWNS_RELOCATED_TESTS) {
    logger.log(
      'classic-branch-protections-are-absent: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'classic-branch-protections-are-absent: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'classic-branch-protections-are-absent: skipped (gh unauthenticated — cannot audit branch protections).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `classic-branch-protections-are-absent: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage(
        'classic-branch-protections-are-absent',
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
      `classic-branch-protections-are-absent: deleting ${findings.length} classic rule(s)…`,
    )
    for (let i = 0, { length } = findings; i < length; i += 1) {
      applyFix(findings[i]!)
    }
    // Re-sweep so success is measured against GitHub's answer, never the
    // fixer's own belief that it succeeded.
    findings = sweep(repos)
  }
  if (findings.length === 0) {
    if (!quiet) {
      logger.log(
        'classic-branch-protections-are-absent: OK — no fleet repo carries a classic branch protection rule.',
      )
    }
    return
  }
  logger.fail(
    'What: classic branch protection rule(s) exist beside the fleet rulesets.\n' +
      `Where: ${findings.map(f => `${f.owner}/${f.repo} '${f.pattern}'`).join(', ')}\n` +
      'Saw: an unmanaged second branch-law surface; wanted: rulesets as the only one.\n' +
      'Fix: node scripts/fleet/check/classic-branch-protections-are-absent.mts --fix',
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no fleet repo carries a classic branch protection rule beside the managed rulesets',
  help: `Usage: node scripts/fleet/check/classic-branch-protections-are-absent.mts [flags] [<repo>…]

  --fix    delete every classic rule found, then re-sweep
  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
