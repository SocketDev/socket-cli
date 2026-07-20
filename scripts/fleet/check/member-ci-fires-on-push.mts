#!/usr/bin/env node
/**
 * @file Assertion: every fleet member's canonical `ci.yml` workflow actually
 *   FIRES on push — no dead CI. A repo can carry a valid `ci.yml` with a
 *   `push:` trigger yet have Actions that never run on push (a fresh private
 *   repo pending org/enterprise Actions activation, a mis-scoped ruleset): the
 *   config reads green, commits land, and nothing is ever verified. A member's
 *   CI silently not running for days — letting a README lint error and a broken
 *   test matrix land unnoticed — is the incident this audit makes loud.
 *   For each repo in fleet-repos.json it reads the push-event run count of the
 *   `ci.yml` workflow via `gh` (`.../actions/workflows/ci.yml/runs?event=push`)
 *   and treats a concrete 0 (workflow registered, never triggered on push) as
 *   dead. An `undefined` count (no `ci.yml` workflow, or an unreadable/errored
 *   query) is NOT dead — only a real 0 counts, so the audit never invents a
 *   finding it cannot stand behind.
 *   Skips CLEANLY — never false-green — when it cannot audit: not on the
 *   release/CI tier (a network sweep has no place in the interactive inner
 *   loop — gated on FLEET_CHECK_RELEASE), no fleet-repos.json (a member
 *   checkout / fresh clone), or `gh` is unauthenticated. Each prints an
 *   explicit "skipped (…)" and exits 0.
 *   Report mode for now (loud warning, exit 0): a known-open, out-of-repo fix
 *   (org/enterprise Actions activation) leaves the fleet with a dead-CI member,
 *   so a hard gate would false-block every push. Flip MODE to 'strict' once the
 *   fleet burns down to zero dead CI — the LINT_MARKDOWN rollout pattern.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Report now, strict after the burn-down (see @file). Strict flips exit 1 on
// any dead CI; report warns loudly and passes so the known-open org fix does
// not false-block the fleet.
const MODE: 'report' | 'strict' = 'report'

// fleet-repos.json entries omit `owner` for the home org; the cross-org
// members (e.g. decmpfs) carry an explicit one.
const DEFAULT_OWNER = 'SocketDev'

export interface FleetRepo {
  readonly name: string
  readonly owner: string
}

export interface RepoCiStatus {
  readonly name: string
  readonly pushRuns: number | undefined
}

/**
 * The canonical private fleet roster path. Present only in the wheelhouse (the
 * sole sanctioned private-name list); absent in a member checkout, where the
 * audit skips.
 */
export function fleetReposPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    '.claude',
    'skills',
    'fleet',
    'cascading-fleet',
    'lib',
    'fleet-repos.json',
  )
}

/**
 * Parse fleet-repos.json into `{ owner, name }` entries, defaulting a missing
 * owner to the home org. Entries without a string `name` are skipped. Pure;
 * exported for tests.
 */
export function parseFleetRepos(json: string): FleetRepo[] {
  const data = JSON.parse(json) as {
    repos?: ReadonlyArray<{ name?: unknown; owner?: unknown }>
  }
  const repos = Array.isArray(data.repos) ? data.repos : []
  const out: FleetRepo[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const entry = repos[i]!
    if (typeof entry.name !== 'string') {
      continue
    }
    out.push({
      name: entry.name,
      owner: typeof entry.owner === 'string' ? entry.owner : DEFAULT_OWNER,
    })
  }
  return out
}

/**
 * The names of repos whose `ci.yml` workflow is registered but has ZERO
 * push-triggered runs — dead CI. An `undefined` count (no workflow / unreadable
 * query) is excluded: only a concrete 0 counts. Pure; exported for tests.
 */
export function deadCiRepos(statuses: readonly RepoCiStatus[]): string[] {
  return statuses
    .filter(status => status.pushRuns === 0)
    .map(status => status.name)
    .sort()
}

// True when `gh` is installed and authenticated — the precondition for the
// workflow-run reads. A miss makes the audit skip cleanly, never fail.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' })
  return result.status === 0
}

// Push-event run count of a repo's canonical `ci.yml` workflow, or undefined
// when the query fails (no such workflow / network / auth). `--jq .total_count`
// yields a bare integer.
function ghPushRunCount(repo: FleetRepo): number | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the sweep reads counts sequentially inline.
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${repo.owner}/${repo.name}/actions/workflows/ci.yml/runs?event=push&per_page=1`,
      '--jq',
      '.total_count',
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    return undefined
  }
  const count = Number.parseInt(String(result.stdout ?? '').trim(), 10)
  return Number.isNaN(count) ? undefined : count
}

export function main(): void {
  // Release/CI tier only — a fleet-wide network sweep, never the interactive
  // inner loop. check.mts sets FLEET_CHECK_RELEASE under --release / CI.
  if (!process.env['FLEET_CHECK_RELEASE']) {
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'member-ci-fires-on-push: skipped (no fleet-repos.json — member checkout / fresh clone).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'member-ci-fires-on-push: skipped (gh unauthenticated — cannot audit workflow runs).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `member-ci-fires-on-push: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const statuses: RepoCiStatus[] = repos.map(repo => ({
    name: repo.name,
    pushRuns: ghPushRunCount(repo),
  }))
  const dead = deadCiRepos(statuses)
  if (dead.length === 0) {
    logger.log(
      "member-ci-fires-on-push: OK — every audited member's ci.yml workflow fires on push.",
    )
    return
  }
  logger.warn(
    `member-ci-fires-on-push: ${dead.length} member(s) carry a ci.yml workflow that has NEVER fired on push (dead CI):`,
  )
  for (const name of dead) {
    logger.warn(`  ${name}`)
  }
  logger.warn(
    'A dead CI lands commits unverified. Check Actions enablement, org/enterprise ' +
      'Actions activation, and branch rulesets. Confirm a fix with: ' +
      'gh api "repos/<owner>/<repo>/actions/workflows/ci.yml/runs?event=push" --jq .total_count',
  )
  if (MODE === 'strict') {
    process.exitCode = 1
  }
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main()
}
/* c8 ignore stop */
