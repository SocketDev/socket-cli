#!/usr/bin/env node
/**
 * @file Assertion: every fleet member's Actions workflow token is read-only
 *   and cannot approve pull request reviews —
 *   `repos/<owner>/<name>/actions/permissions/workflow` must answer
 *   `default_workflow_permissions: "read"` AND
 *   `can_approve_pull_request_reviews: false`. With the default at `write`,
 *   EVERY step of every workflow gets a repo-write GITHUB_TOKEN, so one
 *   compromised step (a poisoned action pin, a hijacked dependency running in
 *   CI) can push branches, tags, and releases; with approvals on, Actions can
 *   satisfy a required-review gate, so the same compromised step can approve
 *   its own pull request. A 2026-07-28 fleet audit found socket-lib and
 *   ultrathink at write + approve and socket-cli at read + approve — quiet
 *   repo SETTINGS, invisible to the cascade, hence a ratchet of their own.
 *   THE LAW IS THE FIX: `--fix` applies one idempotent PUT to the same
 *   endpoint per offending repo — but the write→read flip is FAIL-SAFE. A
 *   workflow with no top-level `permissions:` key runs on the implicit
 *   default token, so flipping the default write→read can break it (jobs that
 *   push, comment, or release on the inherited token). Before flipping, the
 *   fixer reads the repo's `.github/workflows/` file list from the default
 *   branch and requires EVERY workflow file to carry a top-level
 *   `permissions:` key; if any lacks it — or the list/contents are unreadable
 *   — it REFUSES that repo's flip and names the offending files, and the
 *   residual finding still fails the run. The
 *   `can_approve_pull_request_reviews: false` half never waits on that
 *   precondition: disabling Actions-authored approvals cannot break a
 *   legitimate workflow, so it is always applied. After fixing, the sweep
 *   re-reads every repo so success is measured from GitHub's answer, never
 *   the fixer's belief that it succeeded.
 *   Top-level-`permissions:` detection is deliberately YAML-dep-free: a line
 *   matching /^permissions\s*:/ at column 0. Limitation: it cannot see a key
 *   expressed through YAML exotica (a flow mapping at the document root,
 *   anchors/aliases) and does not judge HOW MUCH the key grants — it only
 *   proves the workflow declares something top-level, which is exactly the
 *   break-safety precondition the flip needs.
 *   An unreadable API answer — 404 repo, network, auth, unexpected payload
 *   shape — yields NO findings; only a concrete `write`/`true` counts, so the
 *   audit never invents a finding it cannot stand behind (and never invents
 *   SAFETY either: a payload missing either field is unreadable, not
 *   read/false). Skips CLEANLY — never false-green — off the release/CI tier
 *   (FLEET_CHECK_RELEASE), in a member checkout (wheelhouse-only, gated on
 *   template/base ownership), with no fleet-repos.json (a fresh clone
 *   mid-bootstrap), or when `gh` is unauthenticated.
 */

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'
import type { FleetRepo } from './member-ci-fires-on-push.mts'

const logger = getDefaultLogger()

// Strict from day one: a write-default token is an active exposure on every
// push, not a backlog item — the 2026-07-28 audit findings are exactly what
// this exit code exists to keep loud until remediated.
const MODE: 'report' | 'strict' = 'strict'

/**
 * The law, as data: what the workflow-token settings endpoint must answer.
 */
export const REQUIRED_DEFAULT_WORKFLOW_PERMISSIONS = 'read'
export const REQUIRED_CAN_APPROVE_PULL_REQUEST_REVIEWS = false

/**
 * A top-level `permissions:` key: the line starts at column 0. Deliberately
 * YAML-dep-free (see @file for the limitation) — job-level keys are indented
 * and correctly do NOT count, because a job without its own block still
 * inherits the workflow/default token.
 */
export const TOP_LEVEL_PERMISSIONS_RE = /^permissions\s*:/

/**
 * What one settings read yields, verbatim from GitHub — no defaulting.
 */
export interface TokenProbe {
  readonly canApprovePullRequestReviews: boolean
  readonly defaultWorkflowPermissions: 'read' | 'write'
}

export interface TokenFinding {
  readonly repo: string
  readonly owner: string
  readonly kind: 'can-approve' | 'write-token'
}

/**
 * One workflow file fetched from a repo's default branch.
 */
export interface WorkflowFile {
  readonly path: string
  readonly text: string
}

export type FixRefusal =
  | {
      readonly reason: 'missing-permissions-key'
      readonly files: readonly string[]
    }
  | { readonly reason: 'workflows-unreadable'; readonly files: readonly [] }

/**
 * The single PUT `--fix` will issue for one offending repo, plus any refusal
 * of the write→read half. `setCanApproveFalse` is independent of `refusal` by
 * design — see {@link planRepoFix}.
 */
export interface RepoFixPlan {
  readonly repo: string
  readonly owner: string
  readonly setCanApproveFalse: boolean
  readonly setDefaultRead: boolean
  readonly refusal: FixRefusal | undefined
}

/**
 * Parse the `actions/permissions/workflow` payload into a probe, or undefined
 * when it is not the expected shape. BOTH fields must be present and typed:
 * a missing or malformed field makes the whole answer unreadable — never
 * defaulted to the safe `read`/`false`, which would invent safety, and never
 * defaulted to the unsafe values, which would invent a finding. Pure;
 * exported for tests.
 */
export function parseTokenProbe(json: string): TokenProbe | undefined {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }
  const entry = data as {
    can_approve_pull_request_reviews?: unknown | undefined
    default_workflow_permissions?: unknown | undefined
  }
  const perms = entry.default_workflow_permissions
  const approve = entry.can_approve_pull_request_reviews
  if (perms !== 'read' && perms !== 'write') {
    return undefined
  }
  if (typeof approve !== 'boolean') {
    return undefined
  }
  return {
    canApprovePullRequestReviews: approve,
    defaultWorkflowPermissions: perms,
  }
}

/**
 * The findings for one repo's workflow-token settings: a non-`read` default
 * (`write-token`) and approvals enabled (`can-approve`) — independent
 * findings, since socket-cli demonstrated approve-only drift. An undefined
 * probe (unreadable read) yields NO findings. Pure; exported for tests.
 */
export function tokenFindings(
  repo: FleetRepo,
  probe: TokenProbe | undefined,
): TokenFinding[] {
  if (!probe) {
    return []
  }
  const out: TokenFinding[] = []
  if (
    probe.defaultWorkflowPermissions !== REQUIRED_DEFAULT_WORKFLOW_PERMISSIONS
  ) {
    out.push({ repo: repo.name, owner: repo.owner, kind: 'write-token' })
  }
  if (
    probe.canApprovePullRequestReviews !==
    REQUIRED_CAN_APPROVE_PULL_REQUEST_REVIEWS
  ) {
    out.push({ repo: repo.name, owner: repo.owner, kind: 'can-approve' })
  }
  return out
}

/**
 * The workflow paths that lack a top-level `permissions:` line — the files
 * that would inherit a flipped default and might break. Sorted so refusal
 * output is deterministic. Pure; exported for tests.
 */
export function workflowsMissingPermissions(
  workflows: readonly WorkflowFile[],
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = workflows; i < length; i += 1) {
    const wf = workflows[i]!
    const lines = wf.text.split(/\r?\n/)
    let found = false
    for (let j = 0, { length: lineCount } = lines; j < lineCount; j += 1) {
      if (TOP_LEVEL_PERMISSIONS_RE.test(lines[j]!)) {
        found = true
        break
      }
    }
    if (!found) {
      out.push(wf.path)
    }
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * The remediation the law prescribes for one repo's findings — the single
 * PUT's contents, plus any refusal. Fail-safe on the write→read half: it is
 * planned only when every workflow file provably carries a top-level
 * `permissions:` key; an unreadable workflow list, or any file lacking the
 * key, refuses the flip, and the residual finding fails the run. The
 * `can_approve_pull_request_reviews: false` half is ALWAYS safe — disabling
 * Actions-authored approvals cannot break a workflow — so it never waits on
 * the workflow-file proof. Returns undefined when the repo has no findings.
 * Pure; exported for tests so the plan — what `--fix` will DO and what it
 * will refuse — is provable without gh.
 */
export function planRepoFix(
  repo: FleetRepo,
  findings: readonly TokenFinding[],
  workflows: readonly WorkflowFile[] | undefined,
): RepoFixPlan | undefined {
  let hasWrite = false
  let hasApprove = false
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    if (f.kind === 'write-token') {
      hasWrite = true
    }
    if (f.kind === 'can-approve') {
      hasApprove = true
    }
  }
  if (!hasWrite && !hasApprove) {
    return undefined
  }
  let setDefaultRead = false
  let refusal: FixRefusal | undefined
  if (hasWrite) {
    if (workflows === undefined) {
      refusal = { reason: 'workflows-unreadable', files: [] }
    } else {
      const missing = workflowsMissingPermissions(workflows)
      if (missing.length > 0) {
        refusal = { reason: 'missing-permissions-key', files: missing }
      } else {
        setDefaultRead = true
      }
    }
  }
  return {
    repo: repo.name,
    owner: repo.owner,
    setCanApproveFalse: hasApprove,
    setDefaultRead,
    refusal,
  }
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

// One repo's workflow-token settings probe, or undefined when the read fails
// (missing repo / network / auth) — member-repos-resolve owns missing repos.
function ghTokenProbe(repo: FleetRepo): TokenProbe | undefined {
  const out = gh([
    'api',
    `repos/${repo.owner}/${repo.name}/actions/permissions/workflow`,
  ])
  return out === undefined ? undefined : parseTokenProbe(out)
}

// The repo's `.github/workflows/` files (name + text) from the default
// branch — the contents API serves the default branch when no ref is given.
// Undefined when the listing or any file body is unreadable: the flip's
// safety proof must fail SAFE, so a partial read never masquerades as a
// complete one. Only .yml/.yaml entries count — Actions runs nothing else.
function ghWorkflowFiles(repo: FleetRepo): WorkflowFile[] | undefined {
  const listing = gh([
    'api',
    `repos/${repo.owner}/${repo.name}/contents/.github/workflows`,
    '--jq',
    '[.[] | select(.type == "file") | .path]',
  ])
  if (listing === undefined) {
    return undefined
  }
  let paths: string[] = []
  try {
    const parsed: unknown = JSON.parse(listing)
    if (!Array.isArray(parsed)) {
      return undefined
    }
    paths = parsed.filter(v => typeof v === 'string')
  } catch {
    return undefined
  }
  const out: WorkflowFile[] = []
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const p = paths[i]!
    if (!p.endsWith('.yml') && !p.endsWith('.yaml')) {
      continue
    }
    const text = gh([
      'api',
      '-H',
      'Accept: application/vnd.github.raw+json',
      `repos/${repo.owner}/${repo.name}/contents/${p}`,
    ])
    if (text === undefined) {
      return undefined
    }
    out.push({ path: p, text })
  }
  return out
}

/**
 * Apply one repo's remediation: the single idempotent PUT carrying only the
 * halves the plan authorized. Logs the refusal and names the offending files
 * when the write→read half was refused. Returns true when the PUT succeeded
 * or nothing needed applying — the caller re-sweeps either way, so success is
 * measured from GitHub's answer.
 */
function applyFix(plan: RepoFixPlan): boolean {
  if (plan.refusal) {
    const detail =
      plan.refusal.reason === 'workflows-unreadable'
        ? 'workflow list unreadable — cannot prove the flip is safe'
        : `these workflows lack a top-level permissions: key and rely on the inherited default token: ${plan.refusal.files.join(', ')}`
    logger.warn(`  ${plan.repo}: write→read flip REFUSED — ${detail}`)
  }
  if (!plan.setDefaultRead && !plan.setCanApproveFalse) {
    return true
  }
  const args = [
    'api',
    '-X',
    'PUT',
    `repos/${plan.owner}/${plan.repo}/actions/permissions/workflow`,
  ]
  const applied: string[] = []
  if (plan.setDefaultRead) {
    args.push('-f', 'default_workflow_permissions=read')
    applied.push('default_workflow_permissions=read')
  }
  if (plan.setCanApproveFalse) {
    args.push('-F', 'can_approve_pull_request_reviews=false')
    applied.push('can_approve_pull_request_reviews=false')
  }
  if (gh(args) === undefined) {
    logger.warn(`  ${plan.repo}: workflow-token settings PUT failed`)
    return false
  }
  logger.log(`  ${plan.repo}: applied ${applied.join(', ')}`)
  return true
}

function sweep(repos: readonly FleetRepo[]): TokenFinding[] {
  const findings: TokenFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo = repos[i]!
    findings.push(...tokenFindings(repo, ghTokenProbe(repo)))
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
      'workflow-token-is-read-only: skipped (member checkout — the audit is wheelhouse-only).',
    )
    return
  }
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    logger.log(
      'workflow-token-is-read-only: skipped (no fleet-repos.json — fresh clone mid-bootstrap).',
    )
    return
  }
  if (!ghAuthed()) {
    logger.log(
      'workflow-token-is-read-only: skipped (gh unauthenticated — cannot audit workflow-token settings).',
    )
    return
  }
  let repos: FleetRepo[]
  try {
    repos = parseFleetRepos(readFileSync(reposPath, 'utf8'))
  } catch (e) {
    logger.warn(
      `workflow-token-is-read-only: skipped (could not read fleet-repos.json — ${errorMessage(e)}).`,
    )
    return
  }
  let findings = sweep(repos)
  if (fixMode && findings.length > 0) {
    logger.log(
      `workflow-token-is-read-only: applying the law to ${findings.length} finding(s)…`,
    )
    for (let i = 0, { length } = repos; i < length; i += 1) {
      const repo = repos[i]!
      const repoFindings = findings.filter(
        f => f.repo === repo.name && f.owner === repo.owner,
      )
      if (repoFindings.length === 0) {
        continue
      }
      // The workflow-file proof is fetched only when a write→read flip is on
      // the table — the approve half needs no precondition.
      const needsFlip = repoFindings.some(f => f.kind === 'write-token')
      const workflows = needsFlip ? ghWorkflowFiles(repo) : undefined
      const plan = planRepoFix(repo, repoFindings, workflows)
      if (plan) {
        applyFix(plan)
      }
    }
    // Re-sweep so success is measured against GitHub's answer, never the
    // fixer's own belief that it succeeded.
    findings = sweep(repos)
  }
  if (findings.length === 0) {
    logger.log(
      'workflow-token-is-read-only: OK — every audited repo hands workflows a read-only token and Actions cannot approve pull requests.',
    )
    return
  }
  logger.warn(
    `workflow-token-is-read-only: ${findings.length} workflow-token finding(s) — a write default hands every workflow step a repo-write token, and Actions-authored approvals can satisfy review gates. Remediate with: node scripts/fleet/check/workflow-token-is-read-only.mts --fix`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.warn(
      f.kind === 'write-token'
        ? `  ${f.repo}: default_workflow_permissions is not "read" — every workflow step gets a write token`
        : `  ${f.repo}: can_approve_pull_request_reviews is true — Actions can satisfy required-review gates`,
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
