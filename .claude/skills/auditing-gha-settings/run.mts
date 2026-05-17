#!/usr/bin/env node
/**
 * @fileoverview Audit a repo's GitHub Actions permissions + allowlist
 * against the fleet baseline. Read-only — reports drift, does not write.
 * The fix is a manual step in the repo's Settings → Actions → General
 * page (or via `gh api` PUT with admin scope), because flipping these
 * silently is too dangerous to automate.
 *
 * Baseline (every fleet repo must match):
 *
 *   permissions.enabled              = true
 *   permissions.allowed_actions      = 'selected'
 *   selected_actions.github_owned_allowed = false
 *     (don't allow github-owned actions implicitly — the patterns_allowed
 *     list IS the canonical set; an unlisted github/foo would slip in)
 *   selected_actions.verified_allowed     = false
 *     (same reason — verified marketplace actions aren't on the allowlist
 *     by intent)
 *   selected_actions.patterns_allowed ⊇ CANONICAL_PATTERNS
 *     (superset is allowed — a repo can pin additional actions if it
 *     has a real consumer, but every canonical pattern must be present
 *     since they're referenced through the socket-registry shared
 *     workflows)
 *
 * Exit code: 0 if compliant, 1 if any repo fails the baseline. The
 * orchestrator (skill prompt) shapes the human-readable report and
 * tells the user exactly which Settings → Actions toggles to flip.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

// Canonical fleet allowlist. Every entry here is referenced by at least
// one shared workflow under socket-registry/.github/workflows/ or by a
// fleet repo's own workflows. Removing one breaks every consumer that
// pins through those shared workflows. Add a new entry only when a new
// shared workflow references it, and cascade to every consumer org.
//
// Third-party patterns (dtolnay/, hendrikmuhs/, HaaLeo/, mlugg/,
// pnpm/action-setup, softprops/, Swatinem/) were removed in favor of
// hand-rolled composites under SocketDev/socket-registry/.github/actions/.
// Anything new third-party should be ported to a composite there rather
// than added to this list.
//
// Sorted alphabetically.
const CANONICAL_PATTERNS: readonly string[] = [
  'actions/cache/restore@*',
  'actions/cache/save@*',
  'actions/cache@*',
  'actions/checkout@*',
  'actions/deploy-pages@*',
  'actions/download-artifact@*',
  'actions/github-script@*',
  'actions/setup-go@*',
  'actions/setup-node@*',
  'actions/setup-python@*',
  'actions/upload-artifact@*',
  'actions/upload-pages-artifact@*',
  'depot/build-push-action@*',
  'depot/setup-action@*',
  'github/codeql-action/upload-sarif@*',
]

interface PermissionsResponse {
  enabled: boolean
  allowed_actions: 'all' | 'local_only' | 'selected'
  sha_pinning_required?: boolean
}

interface SelectedActionsResponse {
  github_owned_allowed: boolean
  verified_allowed: boolean
  patterns_allowed: string[]
}

interface RepoFinding {
  repo: string
  ok: boolean
  // Each detail line is one fixable item. Empty when ok=true.
  details: string[]
}

async function gh(args: readonly string[]): Promise<string> {
  const r = await spawn('gh', args as string[], {
    stdio: 'pipe',
    stdioString: true,
    timeout: 30_000,
  })
  return String(r.stdout ?? '').trim()
}

async function fetchPermissions(repo: string): Promise<PermissionsResponse> {
  const raw = await gh(['api', `repos/${repo}/actions/permissions`])
  return JSON.parse(raw) as PermissionsResponse
}

async function fetchSelectedActions(
  repo: string,
): Promise<SelectedActionsResponse> {
  const raw = await gh([
    'api',
    `repos/${repo}/actions/permissions/selected-actions`,
  ])
  return JSON.parse(raw) as SelectedActionsResponse
}

async function auditOne(repo: string): Promise<RepoFinding> {
  const details: string[] = []
  let perms: PermissionsResponse
  try {
    perms = await fetchPermissions(repo)
  } catch (e) {
    // 404 here usually means the API isn't exposing per-repo settings
    // for this repo — either the token lacks admin scope, or the org
    // policy is the source of truth and the repo has no per-repo
    // override. Surface as a fetch failure, not a baseline failure.
    return {
      repo,
      ok: false,
      details: [
        `Could not read Actions permissions (admin scope needed, or org ` +
          `policy supersedes per-repo settings): ${
            e instanceof Error ? e.message : String(e)
          }`,
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
    selected = await fetchSelectedActions(repo)
  } catch (e) {
    details.push(
      `Could not read selected-actions list: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
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

function parseArgs(argv: readonly string[]): {
  repos: string[]
  json: boolean
} {
  const repos: string[] = []
  let json = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--json') {
      json = true
    } else if (a === '-h' || a === '--help') {
      logger.info(
        `Usage: node run.mts [--json] <owner/repo>...

Audits GH Actions permissions + allowlist against the fleet baseline.
Exits non-zero if any repo fails any required check.

Examples:
  node run.mts SocketDev/socket-btm SocketDev/socket-cli
  node run.mts --json SocketDev/socket-btm | jq`,
      )
      process.exit(0)
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`)
    } else {
      repos.push(a)
    }
  }
  if (repos.length === 0) {
    throw new Error('At least one <owner/repo> argument is required.')
  }
  return { repos, json }
}

async function main(): Promise<void> {
  const { repos, json } = parseArgs(process.argv.slice(2))
  const findings: RepoFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const r = repos[i]!
    // eslint-disable-next-line no-await-in-loop -- serial GH API calls
    const f = await auditOne(r)
    findings.push(f)
  }
  if (json) {
    logger.info(JSON.stringify(findings, null, 2))
  } else {
    let okCount = 0
    let failCount = 0
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      if (f.ok) {
        okCount += 1
        logger.info(`✓ ${f.repo}`)
      } else {
        failCount += 1
        logger.warn(`✗ ${f.repo}`)
        for (let j = 0, { length: jl } = f.details; j < jl; j += 1) {
          logger.warn(`    ${f.details[j]}`)
        }
      }
    }
    logger.info('')
    logger.info(`OK: ${okCount}  Failed: ${failCount}`)
  }
  process.exitCode = findings.some(f => !f.ok) ? 1 : 0
}

main().catch(e => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
