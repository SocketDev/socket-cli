#!/usr/bin/env node
/*
 * @file Assertion: every fleet member's GitHub Actions secret and variable
 *   NAMES match a per-repo expectation codified here — law-as-data, names
 *   only. Secret VALUES are never readable through any API and never appear
 *   here; the inventory endpoints (`repos/<owner>/<name>/actions/secrets`,
 *   `…/actions/variables`) return metadata only, and this check keeps it
 *   that way. Two finding kinds, both actionable:
 *
 *   - `undeclared` — a live name the law does not know. This is the loud one: an
 *     unrecognized secret is exfil staging, a stale credential nobody rotated,
 *     or an attacker-added token. Remedy: if it is legitimate, declare it in
 *     SECRET_EXPECTATIONS / VARIABLE_EXPECTATIONS; if not, delete it by hand in
 *     the repo's Actions settings.
 *   - `missing` — an expected name absent from the repo. That is a broken CI
 *     credential: workflows referencing it get an empty string and fail (or
 *     worse, silently no-op). Remedy: add the secret in the repo's Actions
 *     settings — or correct the law when the finding is the expectation being
 *     stale: the 2026-07-28 audit first read socket-lib's absent
 *     SOCKET_API_TOKEN as a gap, but its ci.yml takes the token from the org
 *     secret SOCKET_API_TOKEN_FOR_CLI_AND_SFW, so the repo-level name was never
 *     needed there; its entry now expects only ANTHROPIC_API_KEY. There is
 *     deliberately NO --fix: secret values are unreadable and uncreatable from
 *     here — this audit never holds a value — and deleting an unknown secret is
 *     a human call; automation destroying a credential it cannot inspect is
 *     worse than the finding. Scope: repo-level Actions secrets/variables only.
 *     Org-level secrets shared into a repo do NOT appear in the repo-level
 *     listing these reads use, so they are out of scope here; an org-inventory
 *     audit would need the org endpoints and org-admin scope. Expectations were
 *     seeded from a read-only live sweep of the full roster (2026-07-28
 *     observed): most members carry exactly {ANTHROPIC_API_KEY,
 *     SOCKET_API_TOKEN} — that pair is DEFAULT_EXPECTED — and no member carries
 *     any Actions variable, so the variable default is empty. Per-repo
 *     exceptions are the WHOLE expected list for that repo, not an addition.
 *     For each roster repo the audit reads the two name listings via `gh api`;
 *     an unreadable answer — 404 repo, network, auth — yields NO findings for
 *     that repo and surface; only a concrete name mismatch counts, so the audit
 *     never invents a finding it cannot stand behind (member-repos-resolve owns
 *     missing repos). Exit is strict from day one: any `undeclared` OR any
 *     `missing` fails the run — both demand a human action, and this drift
 *     class lives in repo SETTINGS, invisible to the cascade. Skips CLEANLY —
 *     never false-green — off the release/CI tier (FLEET_CHECK_RELEASE), in a
 *     member checkout (wheelhouse-only, gated on template/base ownership), with
 *     no fleet-repos.json (a fresh clone mid-bootstrap), or when `gh` is
 *     unauthenticated.
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

// Strict from day one: both finding kinds are actionable. `undeclared` is a
// possible exfil-staging/stale/attacker-added credential; `missing` is a
// broken CI credential.
const MODE: 'report' | 'strict' = 'strict'

/**
 * The default expected Actions SECRET names for a roster repo without a
 * SECRET_EXPECTATIONS entry. Seeded from the 2026-07-28 read-only fleet
 * sweep: {ANTHROPIC_API_KEY, SOCKET_API_TOKEN} is the fleet-standard pair.
 */
export const DEFAULT_EXPECTED: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'SOCKET_API_TOKEN',
]

/**
 * Per-repo secret-name law. An entry is the WHOLE expected list for that
 * repo, not an addition to DEFAULT_EXPECTED. Seeded from the 2026-07-28
 * read-only sweep of every roster repo:
 *
 * - The empty-list members carry no repo-level Actions secrets at all.
 * - Bun-security-scanner uses SOCKET_API_KEY (its registry-scanner naming), not
 *   the fleet-standard SOCKET_API_TOKEN.
 * - Socket-packageurl-js adds VALTOWN_TOKEN (Val Town deploy).
 * - Socket-vscode adds its marketplace publish credentials (OPEN_VSX_TOKEN,
 *   VS_MARKETPLACE_TOKEN) and a DRY_RUN toggle.
 * - Stuie carries SOCKET_API_TOKEN only (no ANTHROPIC_API_KEY).
 * - Socket-lib expects only ANTHROPIC_API_KEY: its ci.yml sources the Socket
 *   token from the org secret — see the entry's own comment.
 */
export const SECRET_EXPECTATIONS: Readonly<Record<string, readonly string[]>> =
  {
    abitious: [],
    // oxlint-disable-next-line socket/socket-api-token-env -- the live repo-level secret on bun-security-scanner is literally named SOCKET_API_KEY as observed 2026-07-28; the law records reality, and renaming the secret is a human remediation.
    'bun-security-scanner': ['SOCKET_API_KEY'],
    decmpfs: [],
    depsight: [],
    envrypt: [],
    meander: [],
    'node-smol': [],
    odai: [],
    // Takes the Socket token from the org secret, so no repo-level
    // SOCKET_API_TOKEN is expected.
    'socket-lib': ['ANTHROPIC_API_KEY'],
    'socket-packageurl-js': [
      'ANTHROPIC_API_KEY',
      'SOCKET_API_TOKEN',
      'VALTOWN_TOKEN',
    ],
    'socket-vscode': [
      'ANTHROPIC_API_KEY',
      'DRY_RUN',
      'OPEN_VSX_TOKEN',
      'SOCKET_API_TOKEN',
      'VS_MARKETPLACE_TOKEN',
    ],
    sockeye: [],
    stuie: ['SOCKET_API_TOKEN'],
  }

/**
 * The default expected Actions VARIABLE names for a roster repo without a
 * VARIABLE_EXPECTATIONS entry. The 2026-07-28 sweep found zero variables
 * fleet-wide, so ANY variable appearing anywhere is an `undeclared` finding
 * until someone declares it here.
 */
export const DEFAULT_EXPECTED_VARIABLES: readonly string[] = []

/**
 * Per-repo variable-name law — the parallel of SECRET_EXPECTATIONS. Empty
 * today (2026-07-28 sweep: no roster repo carries any Actions variable).
 */
export const VARIABLE_EXPECTATIONS: Readonly<
  Record<string, readonly string[]>
> = {}

/**
 * The secret names a repo is expected to carry. Pure; exported for tests.
 */
export function expectedSecrets(repo: string): readonly string[] {
  return SECRET_EXPECTATIONS[repo] ?? DEFAULT_EXPECTED
}

/**
 * The variable names a repo is expected to carry. Pure; exported for tests.
 */
export function expectedVariables(repo: string): readonly string[] {
  return VARIABLE_EXPECTATIONS[repo] ?? DEFAULT_EXPECTED_VARIABLES
}

/**
 * Which Actions inventory surface a finding came from.
 */
export type InventorySurface = 'secret' | 'variable'

export interface InventoryFinding {
  readonly repo: string
  readonly owner: string
  readonly surface: InventorySurface
  readonly name: string
  readonly kind: 'missing' | 'undeclared'
}

/**
 * Parse the `gh api … --jq '[.….name]'` projection into a name list, or
 * undefined when the payload is not the expected array-of-strings shape — an
 * unreadable answer must yield no findings, not a crash or a fabricated
 * `missing`. Non-string entries are skipped. Pure; exported for tests.
 */
export function parseNameList(json: string): string[] | undefined {
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
 * The findings for one repo's inventory on one surface: live names the law
 * does not declare (`undeclared`) and declared names the repo does not carry
 * (`missing`). An undefined live list (unreadable read) yields NO findings —
 * fabricating `missing` findings from a network failure would train
 * operators to ignore the check. Pure; exported for tests.
 */
export function inventoryFindings(
  repo: FleetRepo,
  surface: InventorySurface,
  live: readonly string[] | undefined,
  expected: readonly string[],
): InventoryFinding[] {
  if (!live) {
    return []
  }
  const out: InventoryFinding[] = []
  for (let i = 0, { length } = live; i < length; i += 1) {
    const name = live[i]!
    if (!expected.includes(name)) {
      out.push({
        repo: repo.name,
        owner: repo.owner,
        surface,
        name,
        kind: 'undeclared',
      })
    }
  }
  for (let i = 0, { length } = expected; i < length; i += 1) {
    const name = expected[i]!
    if (!live.includes(name)) {
      out.push({
        repo: repo.name,
        owner: repo.owner,
        surface,
        name,
        kind: 'missing',
      })
    }
  }
  return out.toSorted((a, b) =>
    a.name === b.name
      ? a.kind.localeCompare(b.kind)
      : a.name.localeCompare(b.name),
  )
}

// True when `gh` is installed and authenticated — the precondition for the reads.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  return spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
}

// Thin sync `gh` shell-out; stdout on success, undefined on any failure.
function gh(args: readonly string[]): string | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the roster reads run sequentially inline.
  const result = spawnSync('gh', args as string[], { encoding: 'utf8' })
  return result.status === 0 ? String(result.stdout ?? '') : undefined
}

// One repo's live NAME list for a surface, or undefined when the read fails
// (missing repo / network / auth) — member-repos-resolve owns missing repos.
// Names only: the jq projection strips everything but `.name`, so no other
// metadata (and never a value — the API does not expose values) is read.
function ghActionsNames(
  repo: FleetRepo,
  surface: InventorySurface,
): string[] | undefined {
  const listing = surface === 'secret' ? 'secrets' : 'variables'
  const out = gh([
    'api',
    `repos/${repo.owner}/${repo.name}/actions/${listing}`,
    '--jq',
    `[.${listing}[].name]`,
  ])
  return out === undefined ? undefined : parseNameList(out)
}

function sweep(repos: readonly FleetRepo[]): InventoryFinding[] {
  const findings: InventoryFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    findings.push(
      ...inventoryFindings(
        repo,
        'secret',
        ghActionsNames(repo, 'secret'),
        expectedSecrets(repo.name),
      ),
      ...inventoryFindings(
        repo,
        'variable',
        ghActionsNames(repo, 'variable'),
        expectedVariables(repo.name),
      ),
    )
  }
  return findings
}

export function main(): void {
  // Release/CI tier only — a fleet-wide network sweep, never the interactive
  // inner loop. check.mts sets FLEET_CHECK_RELEASE under --release / CI.
  if (!process.env['FLEET_CHECK_RELEASE']) {
    return
  }
  // Wheelhouse-only: the roster cascades fleet-wide for the hook membership
  // law, so every member carries it — without this gate every member's
  // release CI would re-run the same fleet-wide sweep.
  if (!OWNS_RELOCATED_TESTS) {
    logger.log(
      'actions-secrets-are-declared: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'actions-secrets-are-declared: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'actions-secrets-are-declared: skipped (gh unauthenticated — cannot read the Actions inventories).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `actions-secrets-are-declared: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage(
        'actions-secrets-are-declared',
        selection.unmatched,
      ),
    )
    process.exitCode = 1
    return
  }
  repos = selection.selected
  const findings = sweep(repos)
  if (findings.length === 0) {
    logger.log(
      'actions-secrets-are-declared: OK — every audited repo-level Actions secret/variable name matches the declared law.',
    )
    return
  }
  logger.warn(
    `actions-secrets-are-declared: ${findings.length} inventory finding(s). There is NO --fix — values are unreadable/uncreatable from here, and deleting an unknown secret is a human call.`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.warn(
      f.kind === 'undeclared'
        ? `  ${f.repo}: undeclared ${f.surface} ${f.name} — not in the law. If legitimate, declare it in SECRET_EXPECTATIONS/VARIABLE_EXPECTATIONS; if not, delete it by hand in the repo's Actions settings.`
        : `  ${f.repo}: missing ${f.surface} ${f.name} — declared expected but absent, so CI referencing it is broken. Add it in the repo's Actions settings (or remove it from the law if no workflow needs it).`,
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
