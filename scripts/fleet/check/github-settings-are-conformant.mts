#!/usr/bin/env node
/*
 * @file Check (and optionally conform) every fleet repo's GitHub governance
 *   settings against the canonical posture declared in
 *   `.config/fleet/github-settings.json`. This is the sibling of
 *   `auditing-gha/run.mts` (Actions allowlist) and `lint-github-settings.mts`
 *   (merge policy / features / branch protection) — it owns the two governance
 *   surfaces those don't: temporary INTERACTION LIMITS and PULL-REQUEST LIMITS.
 *
 *   Default is a read-only audit (reports drift, exits non-zero on a fixable
 *   failure). `--conform` (alias `--fix`) re-asserts the desired posture via
 *   `gh api` PUT where a REST endpoint exists; needs repo:admin scope.
 *
 *   Interaction limits (`GET/PUT /repos/{owner}/{repo}/interaction-limits`):
 *
 *   - The endpoint returns `{}` when no limit is set, or `{ limit, origin,
 *     expires_at }` when one is. Limits are EXPIRY-BOUND — GitHub auto-lifts
 *     them after the window, so a once-set posture silently lapses. The check
 *     warns on absent/lapsed/weaker-than-declared and re-asserts (resetting the
 *     expiry clock) on --conform.
 *   - Interaction limits CANNOT be set on PRIVATE repos (GitHub returns 405).
 *     The check skips a private repo with a manual-verification note rather
 *     than reporting a false failure.
 *
 *   Pull-request limits ('Limit open PRs from users without write access' +
 *   'Maximum open pull requests per user'): GitHub exposes NO stable REST
 *   endpoint for these — they aren't on `GET /repos/{owner}/{repo}` and have no
 *   dedicated endpoint. So this check captures INTENT only: it prints the
 *   declared values + a manual-verification note pointing at the Settings UI,
 *   and never PUTs them.
 *
 *   Repos are taken from CLI args (`<owner>/<repo>`...) when given, else the
 *   fleet registry (`cascading-fleet/lib/fleet-repos.json`) under the SocketDev
 *   owner plus the wheelhouse itself.
 *
 *   Usage:
 *     node scripts/fleet/check/github-settings-conform.mts          # audit all
 *     node scripts/fleet/check/github-settings-conform.mts --json   # machine
 *     node scripts/fleet/check/github-settings-conform.mts --conform SocketDev/socket-lib
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const FLEET_OWNER = 'SocketDev'

// Interaction-limit strength order — a stronger (higher) posture satisfies a
// weaker declared one. `existing_users` (block new accounts) is the loosest;
// `collaborators_only` is the tightest.
const INTERACTION_STRENGTH: Readonly<Record<string, number>> = {
  __proto__: null,
  collaborators_only: 3,
  contributors_only: 2,
  existing_users: 1,
} as unknown as Record<string, number>

export interface InteractionLimitPosture {
  expiry: string
  limit: string
}

export interface PullRequestLimitPosture {
  maxOpenPerUser: number
  restrictToWriteAccess: boolean
}

export interface GithubSettingsPosture {
  interactionLimit?: InteractionLimitPosture | undefined
  pullRequestLimit?: PullRequestLimitPosture | undefined
}

export interface InteractionLimitResponse {
  expires_at?: string | undefined
  limit?: string | undefined
  origin?: string | undefined
}

export interface RepoFinding {
  // Each detail line is one fixable or applied item. Empty when ok=true.
  details: string[]
  // Manual-verification notes (never flip the verdict).
  manual: string[]
  ok: boolean
  repo: string
}

export interface CliFlags {
  conform: boolean
  json: boolean
  repos: string[]
}

/**
 * Resolve the path to the canonical posture config relative to this script,
 * walking up to the repo root. `check/` sits at `scripts/fleet/check/`, the
 * config at `.config/fleet/github-settings.json` — three levels up from here.
 */
export function resolvePostureConfigPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, '..', '..', '..')
  return path.join(repoRoot, '.config', 'fleet', 'github-settings.json')
}

/**
 * Resolve the fleet registry path relative to this script.
 */
export function resolveFleetReposPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, '..', '..', '..')
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
 * Read + validate the desired posture. Throws a clear error when the config is
 * missing or malformed — a missing posture is a setup defect, not a soft skip.
 */
export function loadPosture(): GithubSettingsPosture {
  const configPath = resolvePostureConfigPath()
  if (!existsSync(configPath)) {
    throw new Error(
      `Posture config not found at ${configPath}. ` +
        'Expected the cascaded .config/fleet/github-settings.json.',
    )
  }
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >
  const posture = { __proto__: null } as unknown as GithubSettingsPosture
  const il = parsed['interactionLimit']
  if (il && typeof il === 'object') {
    const limit = (il as Record<string, unknown>)['limit']
    const expiry = (il as Record<string, unknown>)['expiry']
    if (typeof limit === 'string' && typeof expiry === 'string') {
      posture.interactionLimit = { expiry, limit }
    }
  }
  const prl = parsed['pullRequestLimit']
  if (prl && typeof prl === 'object') {
    const maxOpenPerUser = (prl as Record<string, unknown>)['maxOpenPerUser']
    const restrictToWriteAccess = (prl as Record<string, unknown>)[
      'restrictToWriteAccess'
    ]
    if (
      typeof maxOpenPerUser === 'number' &&
      typeof restrictToWriteAccess === 'boolean'
    ) {
      posture.pullRequestLimit = { maxOpenPerUser, restrictToWriteAccess }
    }
  }
  return posture
}

/**
 * Resolve the list of `<owner>/<repo>` targets. CLI args win; otherwise read
 * the registry and qualify each `name` under the SocketDev owner.
 */
export function resolveRepos(argvRepos: readonly string[]): string[] {
  if (argvRepos.length > 0) {
    return [...argvRepos]
  }
  const registryPath = resolveFleetReposPath()
  if (!existsSync(registryPath)) {
    throw new Error(`Fleet registry not found at ${registryPath}.`)
  }
  const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    repos?: Array<{ name?: string | undefined }> | undefined
  }
  const out: string[] = []
  for (const entry of parsed.repos ?? []) {
    if (typeof entry.name === 'string') {
      out.push(`${FLEET_OWNER}/${entry.name}`)
    }
  }
  return out
}

/**
 * Thin wrapper around `gh api`. Resolves to trimmed stdout; rejects (via the
 * lib spawn contract) on non-zero exit carrying `{ code, stdout, stderr }`.
 */
export async function gh(args: readonly string[]): Promise<string> {
  const r = await spawn('gh', args as string[], {
    stdio: 'pipe',
    stdioString: true,
    timeout: 30_000,
  })
  return String(r.stdout ?? '').trim()
}

/**
 * Fetch a repo's interaction-limit. Returns the parsed body, or `undefined`
 * when the repo is PRIVATE (GitHub 405 — interaction limits aren't settable
 * there). Re-throws any other error to the caller.
 */
export async function fetchInteractionLimit(
  repo: string,
): Promise<InteractionLimitResponse | undefined> {
  try {
    const raw = await gh(['api', `repos/${repo}/interaction-limits`])
    if (!raw) {
      return { __proto__: null } as unknown as InteractionLimitResponse
    }
    return JSON.parse(raw) as InteractionLimitResponse
  } catch (e) {
    const msg = errorMessage(e) ?? ''
    if (/private repositor/i.test(msg) || /\b405\b/.test(msg)) {
      return undefined
    }
    throw e
  }
}

/**
 * Whether `live` satisfies (is at least as strong as) the `desired` interaction
 * limit. A stronger live posture passes; a weaker or absent one fails.
 */
export function interactionLimitSatisfies(options: {
  desired: string
  live: string | undefined
}): boolean {
  const { desired, live } = { __proto__: null, ...options } as typeof options
  if (!live) {
    return false
  }
  const liveRank = INTERACTION_STRENGTH[live] ?? 0
  const desiredRank = INTERACTION_STRENGTH[desired] ?? 0
  return liveRank >= desiredRank
}

/**
 * Audit one repo against the posture. Read-only.
 */
export async function auditOne(options: {
  posture: GithubSettingsPosture
  repo: string
}): Promise<RepoFinding> {
  const { posture, repo } = { __proto__: null, ...options } as typeof options
  const details: string[] = []
  const manual: string[] = []
  const settingsUrl = `https://github.com/${repo}/settings`

  if (posture.interactionLimit) {
    const { limit: desiredLimit } = posture.interactionLimit
    let live: InteractionLimitResponse | undefined
    try {
      live = await fetchInteractionLimit(repo)
    } catch (e) {
      details.push(`Could not read interaction-limits: ${errorMessage(e)}`)
      return { details, manual, ok: false, repo }
    }
    if (live === undefined) {
      manual.push(
        `Interaction limits are not settable on this repo (private). ` +
          `Desired posture (${desiredLimit}) is intent-only here.`,
      )
    } else if (
      !interactionLimitSatisfies({ desired: desiredLimit, live: live.limit })
    ) {
      details.push(
        `interaction-limit is ${live.limit ?? '(none)'}; desired ` +
          `${desiredLimit} (or stronger). Limits are expiry-bound and ` +
          `auto-lapse — re-assert with --conform. Fix: ${settingsUrl}` +
          `#interaction-limits`,
      )
    }
  }

  if (posture.pullRequestLimit) {
    const { maxOpenPerUser, restrictToWriteAccess } = posture.pullRequestLimit
    // No REST endpoint exists for PR limits — intent + manual note only.
    manual.push(
      `Pull-request limits have no REST API; verify in the UI: ` +
        `'Limit open PRs from users without write access' = ` +
        `${restrictToWriteAccess}, 'Maximum open pull requests per user' = ` +
        `${maxOpenPerUser}. ${settingsUrl} → General → Pull Requests.`,
    )
  }

  return { details, manual, ok: details.length === 0, repo }
}

/**
 * Conform one repo to the posture (the `--conform` write mode). Idempotent: it
 * PUTs the interaction limit only when the live posture is absent, lapsed, or
 * weaker than desired. Skips private repos (405) and PR-limits (no endpoint),
 * surfacing both as manual notes.
 */
export async function conformOne(options: {
  posture: GithubSettingsPosture
  repo: string
}): Promise<RepoFinding> {
  const { posture, repo } = { __proto__: null, ...options } as typeof options
  const details: string[] = []
  const manual: string[] = []

  if (posture.interactionLimit) {
    const { expiry, limit } = posture.interactionLimit
    let live: InteractionLimitResponse | undefined
    try {
      live = await fetchInteractionLimit(repo)
    } catch (e) {
      details.push(`Could not read interaction-limits: ${errorMessage(e)}`)
      return { details, manual, ok: false, repo }
    }
    if (live === undefined) {
      manual.push(
        'Interaction limits are not settable on this repo (private); skipped.',
      )
    } else if (
      !interactionLimitSatisfies({ desired: limit, live: live.limit })
    ) {
      try {
        await gh([
          'api',
          '--method',
          'PUT',
          `repos/${repo}/interaction-limits`,
          '-f',
          `limit=${limit}`,
          '-f',
          `expiry=${expiry}`,
        ])
        details.push(`conformed interaction-limit to ${limit} (${expiry})`)
      } catch (e) {
        details.push(`PUT interaction-limits failed: ${errorMessage(e)}`)
        return { details, manual, ok: false, repo }
      }
    }
  }

  if (posture.pullRequestLimit) {
    manual.push(
      'Pull-request limits have no REST API — conform cannot apply them; ' +
        'set them manually in Settings → General → Pull Requests.',
    )
  }

  return { details, manual, ok: true, repo }
}

export function parseArgs(argv: readonly string[]): CliFlags {
  const repos: string[] = []
  let conform = false
  let json = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--json') {
      json = true
    } else if (a === '--conform' || a === '--fix') {
      conform = true
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`)
    } else {
      repos.push(a)
    }
  }
  return { conform, json, repos }
}

export function printFinding(finding: RepoFinding): void {
  if (finding.ok) {
    logger.success(finding.repo)
    for (let i = 0, { length } = finding.details; i < length; i += 1) {
      logger.info(finding.details[i]!)
    }
  } else {
    logger.warn(finding.repo)
    for (let i = 0, { length } = finding.details; i < length; i += 1) {
      logger.warn(finding.details[i]!)
    }
  }
  for (let i = 0, { length } = finding.manual; i < length; i += 1) {
    logger.warn(`manual: ${finding.manual[i]}`)
  }
}

export async function run(flags: CliFlags): Promise<void> {
  const posture = loadPosture()
  const repos = resolveRepos(flags.repos)
  const findings: RepoFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    // eslint-disable-next-line no-await-in-loop -- serial GH API calls
    const finding = flags.conform
      ? await conformOne({ posture, repo })
      : await auditOne({ posture, repo })
    findings.push(finding)
  }
  if (flags.json) {
    logger.info(JSON.stringify(findings, null, 2))
  } else {
    for (let i = 0, { length } = findings; i < length; i += 1) {
      printFinding(findings[i]!)
    }
    const failed = findings.filter(f => !f.ok).length
    logger.info('')
    logger.info(`OK: ${findings.length - failed}  Failed: ${failed}`)
  }
  process.exitCode = findings.some(f => !f.ok) ? 1 : 0
}

async function main(): Promise<void> {
  await run(parseArgs(process.argv.slice(2)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    logger.error(errorMessage(e) ?? String(e))
    process.exitCode = 1
  })
}
