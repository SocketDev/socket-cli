#!/usr/bin/env node
/**
 * @file Assertion: every repo in fleet-repos.json resolves to a real repo in its
 *   org (a roster reference resolves to an actual GitHub repo). Onboarding
 *   must update the roster AND create the actual GitHub repo (in the exact org)
 *   — a roster entry with no repo is a half-onboarded member.
 *   socket-gemini-nano sat in the roster with no `SocketDev/` repo, so its
 *   cascade commits stranded (no origin/main to push to) and its environment
 *   provisioning 404'd. For each member it reads `gh api repos/<owner>/<name>`;
 *   a 404 (repo not found, OR inaccessible to this token) is reported. The
 *   roster's per-entry `owner` defaults to the home org, so a cross-org member
 *   is checked against its own org. Skips CLEANLY — never false-green — off the
 *   release/CI tier (FLEET_CHECK_RELEASE), with no fleet-repos.json (a member
 *   checkout), or when `gh` is unauthenticated. Report mode (loud warn, exit
 *   0): a 404 can also mean "private + no token access", so a hard gate would
 *   false-block; flip MODE to 'strict' once every member repo is confirmed
 *   present + visible.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'
import type { FleetRepo } from './member-ci-fires-on-push.mts'

const logger = getDefaultLogger()

// Report now, strict after every member repo is confirmed present + visible (a
// 404 can also mean private-and-no-token-access, so a hard gate would false-block).
const MODE: 'report' | 'strict' = 'report'

export interface RepoExistence {
  readonly name: string
  readonly exists: boolean | undefined
}

/**
 * Names of members the API reports as NOT FOUND (404). An `undefined` result
 * (network / non-404 error) is excluded — only a concrete miss counts, so the
 * audit never invents a finding it cannot stand behind. Pure; exported for
 * tests.
 */
export function missingRepos(statuses: readonly RepoExistence[]): string[] {
  return statuses
    .filter(status => status.exists === false)
    .map(status => status.name)
    .sort()
}

// True when `gh` is installed and authenticated — the precondition for the reads.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  return spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
}

// True when the repo exists, false on a 404, undefined on any other error.
function ghRepoExists(repo: FleetRepo): boolean | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the sweep reads sequentially inline.
  const result = spawnSync(
    'gh',
    ['api', `repos/${repo.owner}/${repo.name}`, '--jq', '.id'],
    { encoding: 'utf8' },
  )
  if (result.status === 0) {
    return true
  }
  const err = `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`
  return /Not Found|HTTP 404|"status":\s*"404"/.test(err) ? false : undefined
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
      'member-repos-resolve: skipped (no fleet-repos.json — member checkout / fresh clone).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'member-repos-resolve: skipped (gh unauthenticated — cannot audit repo existence).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `member-repos-resolve: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const statuses: RepoExistence[] = repos.map(repo => ({
    name: repo.name,
    exists: ghRepoExists(repo),
  }))
  const missing = missingRepos(statuses)
  if (missing.length === 0) {
    logger.log(
      'member-repos-resolve: OK — every roster member resolves to a repo in its org.',
    )
    return
  }
  logger.warn(
    `member-repos-resolve: ${missing.length} roster member(s) have NO repo in their org (404):`,
  )
  for (const name of missing) {
    logger.warn(`  ${name}`)
  }
  logger.warn(
    'A roster entry with no repo is a half-onboarded member — cascades strand + ' +
      'environments 404. Onboarding must create the repo (`gh repo create ' +
      '<owner>/<name> --private`) AND keep the roster in sync, or remove the ' +
      'entry. A 404 can also mean private + no token access — confirm with: ' +
      'gh repo view <owner>/<name>.',
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
