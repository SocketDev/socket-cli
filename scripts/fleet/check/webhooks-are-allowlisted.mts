#!/usr/bin/env node
/**
 * @file Assertion: every webhook on every fleet member matches the declared
 *   allowlist below. A repo webhook is a standing exfiltration channel — it
 *   ships push/PR/issue payloads (branch names, commit messages, author
 *   emails) to an arbitrary URL, and an attacker with brief admin access can
 *   add one that keeps reporting long after the access is revoked. Webhooks
 *   are repo SETTINGS — invisible to the cascade and to code review — so this
 *   drift class needs its own ratchet.
 *   THE LAW IS THE DATA: {@link WEBHOOK_ALLOWLIST} declares every sanctioned
 *   hook as repo + URL PREFIX. Prefix (never exact-URL) matching keeps
 *   rotating tokens in query strings from flapping the check, and entries
 *   deliberately stop at origin + path prefix so no secret-looking token is
 *   ever committed here. The seed is the fleet-wide read-only sweep of
 *   2026-07-28: four hooks across socket-cli, socket-mcp, and socket-sdk-js,
 *   all Notion EAP endpoints, all observed pre-existing — declared as-is
 *   because the point is future DRIFT detection, not relitigating existing
 *   hooks.
 *   MODE is strict from day one: the seed covers everything observed, so a
 *   finding here is a NEW hook, never a known-open backlog item. There is
 *   deliberately NO --fix: deleting a webhook is destructive and its intent
 *   is unknowable from code — this check's job is to make an attacker-added
 *   hook LOUD, not to clean up after one. The remedy for a sanctioned new
 *   hook is widening {@link WEBHOOK_ALLOWLIST} (repo + origin/path prefix,
 *   dated comment); the remedy for a hostile one is deletion by hand:
 *   gh api -X DELETE repos/<owner>/<repo>/hooks/<id>.
 *   For each roster repo it reads gh api repos/<owner>/<name>/hooks; an
 *   unreadable answer — 404 repo, network, auth, insufficient scope, a
 *   payload row the parser cannot identify — yields NO findings but is NOTED,
 *   so the audit never invents a finding it cannot stand behind and never
 *   passes silence off as a clean sweep. Findings log the URL's ORIGIN plus
 *   first path segment at most — never the full URL, whose path/params may
 *   carry capability tokens that do not belong in CI logs.
 *   Skips CLEANLY — never false-green — off the release/CI tier
 *   (FLEET_CHECK_RELEASE), in a member checkout (wheelhouse-only, gated on
 *   template/base ownership), with no fleet-repos.json (a fresh clone
 *   mid-bootstrap), or when gh is unauthenticated.
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
import { runMain } from '../_shared/run-main.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'
import type { FleetRepo } from './member-ci-fires-on-push.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// Strict from day one: the 2026-07-28 seed sweep declared every hook observed
// live, so a finding here is fresh drift — a NEW hook — never a known-open
// backlog item (contrast member-ci-fires-on-push's report mode).
const MODE: 'report' | 'strict' = 'strict'

/**
 * One sanctioned webhook: the repo it lives on and the URL prefix it must
 * start with. Prefixes stop at origin + path — never copy a hook URL's
 * secret-looking path/params (delivery UUIDs, tokens) into an entry.
 */
export interface WebhookAllowlistEntry {
  readonly repo: string
  readonly urlPrefix: string
}

/**
 * The law as data: every webhook the fleet sanctions, by repo + URL prefix.
 * A hook matching no entry FOR ITS REPO is a finding. Widen this list (with a
 * dated comment) to sanction a new hook; delete hostile hooks by hand.
 */
export const WEBHOOK_ALLOWLIST: readonly WebhookAllowlistEntry[] = [
  // 2026-07-28, observed pre-existing: one Notion EAP webhook (hook 388575923).
  { repo: 'socket-cli', urlPrefix: 'https://www.notion.so/eap/webhook/' },
  // 2026-07-28, observed pre-existing: two Notion EAP webhooks (hooks
  // 634810481, 638742423).
  { repo: 'socket-mcp', urlPrefix: 'https://www.notion.so/eap/webhook/' },
  // 2026-07-28, observed pre-existing: one Notion EAP webhook (hook 638241395).
  { repo: 'socket-sdk-js', urlPrefix: 'https://www.notion.so/eap/webhook/' },
]

/**
 * What one hook read yields: the hook's id (the handle a hand-run DELETE
 * needs), its delivery URL, and whether GitHub reports it active. An inactive
 * hook is still audited — an attacker can flip it back on.
 */
export interface HookProbe {
  readonly active: boolean
  readonly id: number
  readonly url: string
}

export interface HookFinding {
  readonly active: boolean
  readonly hookId: number
  readonly origin: string
  readonly owner: string
  readonly repo: string
}

/**
 * Parse the gh api …/hooks jq projection (see ghRepoHooks) into probes, or
 * undefined when the payload is not the expected shape — an unreadable answer
 * must yield no findings, not a crash or a fabricated one. A row without a
 * numeric id or string url poisons the WHOLE payload (undefined, noted as
 * unreadable) rather than being skipped: silently dropping a hook the parser
 * cannot identify would invent cleanliness. Pure; exported for tests.
 */
export function parseHookProbes(json: string): HookProbe[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) {
    return undefined
  }
  const out: HookProbe[] = []
  for (let i = 0, { length } = data; i < length; i += 1) {
    const entry = data[i] as {
      active?: unknown | undefined
      id?: unknown | undefined
      url?: unknown | undefined
    }
    if (typeof entry?.id !== 'number' || typeof entry?.url !== 'string') {
      return undefined
    }
    out.push({ active: entry.active === true, id: entry.id, url: entry.url })
  }
  return out
}

/**
 * True when a hook URL on the named repo matches a sanctioned entry: the
 * entry must be declared FOR THAT REPO and the URL must START WITH the
 * entry's prefix (startsWith, never a substring test — a substring test lets
 * evil.example/?x=<prefix> smuggle the sanctioned prefix into a hostile URL).
 * Pure; exported for tests.
 */
export function hookIsAllowed(
  repoName: string,
  url: string,
  allowlist: readonly WebhookAllowlistEntry[] = WEBHOOK_ALLOWLIST,
): boolean {
  for (let i = 0, { length } = allowlist; i < length; i += 1) {
    const entry = allowlist[i]!
    if (entry.repo === repoName && url.startsWith(entry.urlPrefix)) {
      return true
    }
  }
  return false
}

/**
 * The loggable identity of a hook URL: origin plus first path segment at
 * most. Full hook URLs carry delivery UUIDs and tokens in their paths and
 * params — those must never reach CI logs. Pure; exported for tests.
 */
export function hookUrlOrigin(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '(unparseable url)'
  }
  const segments = parsed.pathname.split('/').filter(s => s.length > 0)
  return segments.length > 0 ? `${parsed.origin}/${segments[0]}` : parsed.origin
}

/**
 * The findings for one repo's webhooks: every hook matching no allowlist
 * entry for that repo, active or not. An undefined probe list (unreadable
 * answer) yields NO findings — the caller notes the repo instead. Pure;
 * exported for tests.
 */
export function webhookFindings(
  repo: FleetRepo,
  hooks: readonly HookProbe[] | undefined,
  allowlist: readonly WebhookAllowlistEntry[] = WEBHOOK_ALLOWLIST,
): HookFinding[] {
  if (!hooks) {
    return []
  }
  const out: HookFinding[] = []
  for (let i = 0, { length } = hooks; i < length; i += 1) {
    const hook = hooks[i]!
    if (hookIsAllowed(repo.name, hook.url, allowlist)) {
      continue
    }
    out.push({
      active: hook.active,
      hookId: hook.id,
      origin: hookUrlOrigin(hook.url),
      owner: repo.owner,
      repo: repo.name,
    })
  }
  return out.toSorted((a, b) =>
    a.repo === b.repo ? a.hookId - b.hookId : a.repo.localeCompare(b.repo),
  )
}

// True when gh is installed and authenticated — the precondition for the reads.
function ghAuthed(): boolean {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the auth probe must resolve inline before the sweep.
  return spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0
}

// Thin sync gh shell-out; stdout on success, undefined on any failure.
function gh(args: readonly string[]): string | undefined {
  // oxlint-disable-next-line socket/prefer-async-spawn -- main() is a sync CLI check; the roster reads apply sequentially inline.
  const result = spawnSync('gh', args as string[], { encoding: 'utf8' })
  return result.status === 0 ? String(result.stdout ?? '') : undefined
}

// One repo's hook probes, or undefined when the read fails (missing repo /
// network / auth / scope) — member-repos-resolve owns missing repos.
function ghRepoHooks(repo: FleetRepo): HookProbe[] | undefined {
  const out = gh([
    'api',
    `repos/${repo.owner}/${repo.name}/hooks`,
    '--jq',
    '[.[] | {id: .id, url: .config.url, active: .active}]',
  ])
  return out === undefined ? undefined : parseHookProbes(out)
}

function sweep(repos: readonly FleetRepo[]): {
  findings: HookFinding[]
  unreadable: string[]
} {
  const findings: HookFinding[] = []
  const unreadable: string[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    const hooks = ghRepoHooks(repo)
    if (hooks === undefined) {
      unreadable.push(repo.name)
      continue
    }
    findings.push(...webhookFindings(repo, hooks))
  }
  return { findings, unreadable }
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
      'webhooks-are-allowlisted: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'webhooks-are-allowlisted: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'webhooks-are-allowlisted: skipped (gh unauthenticated — cannot audit webhooks).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `webhooks-are-allowlisted: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  const selection = selectRepos(repos, parseRepoFilter(process.argv))
  if (selection.unmatched.length > 0) {
    logger.fail(
      unmatchedSelectorMessage('webhooks-are-allowlisted', selection.unmatched),
    )
    process.exitCode = 1
    return
  }
  repos = selection.selected
  const { findings, unreadable } = sweep(repos)
  if (unreadable.length > 0) {
    logger.warn(
      `webhooks-are-allowlisted: ${unreadable.length} repo(s) unreadable — not audited, NOT assumed clean: ${unreadable.join(', ')}`,
    )
  }
  if (findings.length === 0) {
    logger.log(
      'webhooks-are-allowlisted: OK — every readable roster webhook matches WEBHOOK_ALLOWLIST.',
    )
    return
  }
  logger.warn(
    `webhooks-are-allowlisted: ${findings.length} webhook finding(s) — a hook outside WEBHOOK_ALLOWLIST is either a new sanctioned integration (widen the allowlist in this file, dated) or an attacker-added exfiltration channel (delete it by hand: gh api -X DELETE repos/<owner>/<repo>/hooks/<id>). There is no --fix by design.`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.warn(
      `  ${f.repo}: hook ${f.hookId} — ${f.origin}${f.active ? '' : ' (inactive)'} — matches no allowlist entry for this repo`,
    )
  }
  if (MODE === 'strict') {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "audits every fleet member's repo webhooks against the declared allowlist",
  help: `Usage: node scripts/fleet/check/webhooks-are-allowlisted.mts [flags]

  --repo <name>[,<name>…]  narrow the sweep to the named roster repos (repeatable)`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
