#!/usr/bin/env node
/**
 * @file Check, and optionally conform, a repo's GitHub Actions permissions +
 *   allowlist against the fleet baseline. Default is read-only audit (reports
 *   drift, exits non-zero on failure); `--conform` (alias `--fix`) WRITES the
 *   baseline via `gh api` PUT, needs admin scope. Conform is superset-safe: it
 *   sets allowed_actions=selected, github_owned_allowed=false,
 *   verified_allowed=false, and the UNION of the repo's current patterns + the
 *   canonical set — a repo's extra pins are preserved, only missing canonical
 *   patterns are added, never pruned. Baseline, every fleet repo must match:
 *   permissions.enabled = true permissions.allowed_actions = 'selected'
 *   selected_actions.github_owned_allowed = false (don't allow github-owned
 *   actions implicitly — the patterns_allowed list IS the canonical set; an
 *   unlisted github/foo would slip in) selected_actions.verified_allowed =
 *   false (same reason — verified marketplace actions aren't on the allowlist
 *   by intent) selected_actions.patterns_allowed ⊇ CANONICAL_PATTERNS (superset
 *   is allowed — a repo can pin additional actions if it has a real consumer,
 *   but every canonical pattern must be present since they're referenced
 *   through the socket-registry shared workflows) Exit code: 0 if compliant, 1
 *   if any repo fails the baseline. `--fleet` derives the repo list from the
 *   single-source roster (cascading-fleet/lib/fleet-repos.json). A repo that
 *   does not exist on GitHub is a distinct loud finding — the roster entry is
 *   the defect — never folded into the admin-scope/org-policy fetch failure.
 *   The orchestrator, skill prompt, shapes the human-readable report and tells
 *   the user exactly which Settings → Actions toggles to flip.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

import { isMainModule } from '../../../../scripts/fleet/_shared/is-main-module.mts'

// The canonical allowlist is DATA shared with the
// gha-allowlist-matches-template-uses fleet check — it lives in its own
// module so consumers can import the list without the runner's gh seams.
import { CANONICAL_PATTERNS } from './canonical-patterns.mts'
import type { ConformResult, RepoFinding } from './run-report.mts'
import { runAudit, runConform } from './run-report.mts'

const logger = getDefaultLogger()

// The single-source fleet roster, shipped next to this skill by the cascade.
// `--fleet` derives the audit's <owner>/<repo> list from it so no prose list
// can drift — a hand-maintained slug list is how a typo once dropped a repo
// from the fleet pass for a week.
const FLEET_ROSTER_URL = new URL(
  '../cascading-fleet/lib/fleet-repos.json',
  import.meta.url,
)

// The gh CLI seam, injectable so tests can drive the 404-vs-scope branches
// without spawning gh.
export type GhFn = (args: readonly string[]) => Promise<string>

// Loud not-found finding, What/Where/Saw/Fix shaped. A nonexistent repo means
// the ROSTER ENTRY is wrong — reporting it as a permissions hiccup reads as
// benign, and the fleet pass then skips the real repo while looking conformed.
export function repoNotFoundDetail(repo: string): string {
  return (
    `Repo not found on GitHub — the roster entry is wrong, not the repo's ` +
    `settings. Where: whatever named ${repo} — fleet-repos.json via ` +
    `--fleet, the SKILL.md invocation, or the caller's args. Saw: gh api ` +
    `repos/${repo} failed and the repo itself is unreadable; wanted: an ` +
    `existing repo. Fix: correct the roster entry — a skipped repo reads ` +
    `as conformed.`
  )
}

/**
 * True when `gh api repos/<owner>/<repo>` resolves — the repo exists and the
 * token can at least read its metadata. Used to split "the roster names a
 * repo that doesn't exist" from "the repo exists but its Actions settings
 * aren't readable".
 */
export async function repoExists(
  repo: string,
  ghFn: GhFn = gh,
): Promise<boolean> {
  try {
    await ghFn(['api', `repos/${repo}`])
    return true
  } catch {
    return false
  }
}

export async function auditOne(
  repo: string,
  ghFn: GhFn = gh,
): Promise<RepoFinding> {
  const details: string[] = []
  let perms: PermissionsResponse
  try {
    perms = await fetchPermissions(repo, ghFn)
  } catch (e) {
    // A nonexistent repo — a roster typo — fails this fetch exactly like a
    // scope problem does. Probe the repo itself so the finding names the
    // real defect instead of shrugging it off as a permissions issue.
    if (!(await repoExists(repo, ghFn))) {
      return { repo, ok: false, details: [repoNotFoundDetail(repo)] }
    }
    // The repo exists, so the failure is access-shaped: the token lacks
    // admin scope, or org policy is the source of truth and the repo has
    // no per-repo override. Surface as a fetch failure, not a baseline
    // failure.
    return {
      repo,
      ok: false,
      details: [
        `Could not read Actions permissions (admin scope needed, or org ` +
          `policy supersedes per-repo settings): ${errorMessage(e)}`,
      ],
    }
  }

  // `enabled: false` does NOT mean Actions are disabled — it means the
  // per-repo override is unset, and the org-level policy is in effect.
  // We can't audit allowlist + policy from the repo API in that case;
  // tell the user to check at the org level (or set a per-repo override
  // that mirrors the canonical baseline so drift surfaces locally).
  if (!perms.enabled) {
    details.push(
      `Per-repo Actions override is unset (enabled=false at the repo ` +
        `level). Org-level policy is the effective source of truth — the ` +
        `repo runs whatever the org allows, and the per-repo allowlist isn't ` +
        `enforced. To get drift-detection on this repo, opt in to per-repo ` +
        `settings at Settings → Actions → General and mirror the canonical ` +
        `baseline (allowed_actions=selected, github_owned_allowed=false, ` +
        `verified_allowed=false, and the canonical patterns).`,
    )
    return { repo, ok: false, details }
  }

  if (perms.allowed_actions !== 'selected') {
    details.push(
      `allowed_actions=${perms.allowed_actions}; baseline is "selected". ` +
        'Set Settings → Actions → General → "Allow enterprise, and select ' +
        'non-enterprise, actions and reusable workflows".',
    )
    // If it's `all` or `local_only` the selected-actions endpoint will
    // 404 — skip the next fetch.
    return { repo, ok: false, details }
  }

  let selected: SelectedActionsResponse
  try {
    selected = await fetchSelectedActions(repo, ghFn)
  } catch (e) {
    details.push(`Could not read selected-actions list: ${errorMessage(e)}`)
    return { repo, ok: false, details }
  }

  if (selected.github_owned_allowed) {
    details.push(
      'github_owned_allowed=true. Baseline is false — every github/* action ' +
        'should go through the explicit allowlist so an unintended github/foo ' +
        'cannot slip in. Uncheck "Allow actions created by GitHub" in Settings.',
    )
  }
  if (selected.verified_allowed) {
    details.push(
      'verified_allowed=true. Baseline is false — verified-marketplace ' +
        'actions are not implicitly allowed. Uncheck "Allow Marketplace actions ' +
        'by verified creators" in Settings.',
    )
  }

  const present = new Set(selected.patterns_allowed)
  const missing: string[] = []
  for (let i = 0, { length } = CANONICAL_PATTERNS; i < length; i += 1) {
    const p = CANONICAL_PATTERNS[i]!
    if (!present.has(p)) {
      missing.push(p)
    }
  }
  if (missing.length > 0) {
    details.push(
      `Missing ${missing.length} canonical patterns from the allowlist:\n  ` +
        `${missing.join('\n  ')}\n` +
        'Add via Settings → Actions → General → "Allow specified actions and ' +
        'reusable workflows" → one entry per line.',
    )
  }

  // Extras (repo allows MORE than the canonical set) are NOT findings —
  // a repo may pin a one-off action with a real consumer. Report them
  // as info so the operator can audit, but don't fail.
  const extras: string[] = []
  for (let i = 0, { length } = selected.patterns_allowed; i < length; i += 1) {
    const p = selected.patterns_allowed[i]!
    if (!CANONICAL_PATTERNS.includes(p)) {
      extras.push(p)
    }
  }
  if (extras.length > 0) {
    details.push(
      `Info: ${extras.length} extra allowlist patterns beyond the canonical ` +
        `set:\n  ${extras.join('\n  ')}\n` +
        'These are not failures — a repo may legitimately allow more. ' +
        'But each extra should map to a real consumer; if not, prune.',
    )
  }

  // ok=true means every required-baseline check passed; "info" entries
  // about extras don't flip the verdict.
  const failedRequired =
    !perms.enabled ||
    perms.allowed_actions !== 'selected' ||
    selected.github_owned_allowed ||
    selected.verified_allowed ||
    missing.length > 0
  return { repo, ok: !failedRequired, details }
}

/**
 * Conform a repo to the baseline (the `--conform` write mode). Idempotent and
 * superset-safe: sets `allowed_actions=selected`, `github_owned_allowed=false`,
 * `verified_allowed=false`, and the `patterns_allowed` UNION of the repo's
 * current patterns + CANONICAL_PATTERNS. A repo's extra (non-canonical) pins
 * are preserved, never pruned — conform only ADDS the missing canonical
 * patterns and tightens the two toggles. Returns the patterns it added (empty
 * when already compliant). Skips a repo whose per-repo override is unset
 * (`enabled=false`): org policy governs there and a per-repo PUT would silently
 * create an override.
 */
export async function conformOne(
  repo: string,
  ghFn: GhFn = gh,
  ghInputFn: typeof ghInput = ghInput,
): Promise<ConformResult> {
  let perms: PermissionsResponse
  try {
    perms = await fetchPermissions(repo, ghFn)
  } catch (e) {
    // Same split as auditOne: a roster typo must not read as a scope
    // problem — the conform pass would skip the real repo while its
    // summary looks like an environment hiccup.
    if (!(await repoExists(repo, ghFn))) {
      return {
        repo,
        changed: false,
        added: [],
        error: repoNotFoundDetail(repo),
      }
    }
    return {
      repo,
      changed: false,
      added: [],
      error: `could not read permissions (admin scope needed): ${errorMessage(e)}`,
    }
  }
  if (!perms.enabled) {
    return {
      repo,
      changed: false,
      added: [],
      error:
        'per-repo Actions override is unset (org policy governs); not creating ' +
        'an override automatically — opt in at Settings → Actions first',
    }
  }

  // Ensure allowed_actions=selected before touching the selected-actions list
  // (the selected-actions endpoint 404s under all/local_only). The permissions
  // PUT requires BOTH `enabled` (bool, -F) and `allowed_actions` (-f) — a
  // partial body is rejected `Invalid request`.
  if (perms.allowed_actions !== 'selected') {
    await ghFn([
      'api',
      '--method',
      'PUT',
      `repos/${repo}/actions/permissions`,
      '-F',
      'enabled=true',
      '-f',
      'allowed_actions=selected',
    ])
  }

  let current: SelectedActionsResponse
  try {
    current = await fetchSelectedActions(repo, ghFn)
  } catch {
    current = {
      github_owned_allowed: false,
      verified_allowed: false,
      patterns_allowed: [],
    }
  }

  // Union: keep every existing pattern, add any missing canonical one. Sorted
  // for a stable, diff-friendly write.
  const union = new Set(current.patterns_allowed)
  const added: string[] = []
  for (let i = 0, { length } = CANONICAL_PATTERNS; i < length; i += 1) {
    const p = CANONICAL_PATTERNS[i]!
    if (!union.has(p)) {
      union.add(p)
      added.push(p)
    }
  }
  const tighteningToggles =
    current.github_owned_allowed || current.verified_allowed
  const wasSelected = perms.allowed_actions === 'selected'
  if (added.length === 0 && !tighteningToggles && wasSelected) {
    return { repo, changed: false, added: [] }
  }

  const merged = [...union].toSorted()
  const body = JSON.stringify({
    github_owned_allowed: false,
    verified_allowed: false,
    patterns_allowed: merged,
  })
  // PUT the full selected-actions object via a temp-file body (--input
  // <file>) so the array + booleans go as proper JSON, not -f string fields.
  await ghInputFn(
    [
      'api',
      '--method',
      'PUT',
      `repos/${repo}/actions/permissions/selected-actions`,
      '--input',
      '{body}',
    ],
    body,
  )
  return { repo, changed: true, added }
}

export async function fetchPermissions(
  repo: string,
  ghFn: GhFn = gh,
): Promise<PermissionsResponse> {
  const raw = await ghFn(['api', `repos/${repo}/actions/permissions`])
  return JSON.parse(raw) as PermissionsResponse
}

export async function fetchSelectedActions(
  repo: string,
  ghFn: GhFn = gh,
): Promise<SelectedActionsResponse> {
  const raw = await ghFn([
    'api',
    `repos/${repo}/actions/permissions/selected-actions`,
  ])
  return JSON.parse(raw) as SelectedActionsResponse
}

/**
 * Derive the fleet's `<owner>/<name>` slugs from the roster JSON. Pure core of
 * `--fleet`, exported for tests; `owner` defaults to SocketDev exactly like the
 * cascade's owner map. Throws when the roster carries no usable entries —
 * fail closed, an empty fleet pass must never read as a conformed fleet.
 */
export function fleetSlugsFromRoster(raw: string, source: string): string[] {
  const parsed = JSON.parse(raw) as {
    repos?:
      | Array<{ name?: string | undefined; owner?: string | undefined }>
      | undefined
  }
  const entries = parsed.repos ?? []
  const slugs: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (typeof entry.name === 'string' && entry.name.length > 0) {
      slugs.push(`${entry.owner ?? 'SocketDev'}/${entry.name}`)
    }
  }
  if (slugs.length === 0) {
    throw new Error(
      `Fleet roster has no usable entries. Where: ${source}. Saw: no ` +
        `repos[].name values; wanted: the fleet membership list. Fix: ` +
        `restore the roster — it is the single source of fleet membership.`,
    )
  }
  return slugs
}

// Read the on-disk roster that cascades alongside this skill.
export function loadFleetSlugs(): string[] {
  return fleetSlugsFromRoster(
    readFileSync(FLEET_ROSTER_URL, 'utf8'),
    fileURLToPath(FLEET_ROSTER_URL),
  )
}

interface PermissionsResponse {
  enabled: boolean
  allowed_actions: 'all' | 'local_only' | 'selected'
  sha_pinning_required?: boolean | undefined
}

interface SelectedActionsResponse {
  github_owned_allowed: boolean
  verified_allowed: boolean
  patterns_allowed: string[]
}

export async function gh(args: readonly string[]): Promise<string> {
  const r = await spawn('gh', args as string[], {
    stdio: 'pipe',
    stdioString: true,
    timeout: 30_000,
  })
  return String(r.stdout ?? '').trim()
}

// `gh api` with a JSON request body (for PUT bodies carrying arrays + booleans,
// which `-f key=value` can't express). The body is written to a temp file and
// passed via `gh api --input <file>` — the lib spawn does not wire a child's
// stdin, so `--input -` (stdin) doesn't work here; a file is the robust path.
// `{body}` in `args` is replaced with the temp-file path.
export async function ghInput(
  args: readonly string[],
  body: string,
): Promise<string> {
  const file = path.join(
    os.tmpdir(),
    `gha-conform-${process.pid}-${args.length}.json`,
  )
  writeFileSync(file, body)
  try {
    const resolved = args.map(a => (a === '{body}' ? file : a))
    const r = await spawn('gh', resolved, {
      stdio: 'pipe',
      stdioString: true,
      timeout: 30_000,
    })
    return String(r.stdout ?? '').trim()
  } finally {
    safeDeleteSync(file)
  }
}

export function parseArgs(argv: readonly string[]): {
  repos: string[]
  json: boolean
  conform: boolean
  fleet: boolean
} {
  const repos: string[] = []
  let json = false
  let conform = false
  let fleet = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--json') {
      json = true
    } else if (a === '--conform' || a === '--fix') {
      conform = true
    } else if (a === '--fleet') {
      fleet = true
    } else if (a === '--help' || a === '-h') {
      logger.info(
        // oxlint-disable-next-line socket/no-logger-newline-literal -- CLI help text is intentionally a single multi-line block; splitting would garble the columnar formatting users expect.
        `Usage: node run.mts [--json] [--conform] [--fleet] [<owner/repo>...]

Checks GH Actions permissions + allowlist against the fleet baseline.
Default is read-only (audit); exits non-zero if any repo fails a check.

  --conform  (alias --fix) WRITE mode: PUT the baseline to each repo —
             allowed_actions=selected, github_owned_allowed=false,
             verified_allowed=false, and the UNION of the repo's current
             patterns + the canonical set (extras preserved, never pruned;
             only missing canonical patterns are added). Needs admin scope.
  --fleet    derive the repo list from the single-source roster
             (cascading-fleet/lib/fleet-repos.json) instead of a
             hand-maintained slug list. Combines with explicit args.
  --json     machine-readable findings.

Examples:
  node run.mts SocketDev/socket-btm SocketDev/socket-cli
  node run.mts --fleet
  node run.mts --conform --fleet
  node run.mts --json SocketDev/socket-btm | jq`,
      )
      process.exit(0)
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`)
    } else {
      repos.push(a)
    }
  }
  if (repos.length === 0 && !fleet) {
    throw new Error(
      'At least one <owner/repo> argument is required — or pass --fleet ' +
        'to derive the list from fleet-repos.json.',
    )
  }
  return { repos, json, conform, fleet }
}

async function main(): Promise<void> {
  const { repos, json, conform, fleet } = parseArgs(process.argv.slice(2))
  const targets = fleet ? [...new Set([...loadFleetSlugs(), ...repos])] : repos
  if (conform) {
    await runConform(targets, { json })
  } else {
    await runAudit(targets, { json })
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(e => {
    logger.error(errorMessage(e))
    process.exit(1)
  })
}
