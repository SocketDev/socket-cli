#!/usr/bin/env node
// Claude Code PreToolUse hook — no-duplicate-pr-guard.
//
// HARD-BLOCKS `gh pr create` when an OPEN pull request already exists for the
// SAME head branch against the SAME base. There is no legitimate reason to
// open a second PR for a head that already has one: the work belongs on the PR
// that exists, so the correct move is `gh pr edit <n>` or a push to that
// branch. A duplicate splits the review, orphans the CI history, and — when
// the operator then closes the loser — risks a close GitHub will not always
// let you undo (`reopenPullRequest` can refuse outright).
//
// Universal safety: fires everywhere via `global: true`, in non-fleet repos
// too. PR churn is not a fleet convention, so `scope` is deliberately omitted.
//
// Detection rides the shared `gh pr create` parser (`_shared/gh-pr-command.mts`),
// never a regex, so `&&` chains, quoting, and a literal "gh pr create" inside a
// `--body` can't false-fire. The `gh pr list` probe runs ONLY after the parse
// confirms a real `gh pr create`, is network-bounded, and FAILS OPEN on any
// error — a guard that blocks because GitHub was slow is worse than the churn.
//
// Bypass: `Allow duplicate-pr bypass` in a recent user turn.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { ghPrCreateCommand, isGhPrCreate } from '../_shared/gh-pr-command.mts'
import { ghExplicitRepoArg } from '../_shared/gh-target-repo.mts'
import { currentBranch, resolveDefaultBranch } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { flagValue } from '../_shared/shell-command.mts'
// stripOwnerPrefix is the sibling head-vetting guard's — imported, never
// forked, so `--head owner:branch` reduces the same way in both.
import { stripOwnerPrefix } from '../no-pr-from-default-branch-guard/index.mts'

// Dispatcher pre-flight: every invocation this guard can care about carries the
// substring `gh`. A payload without it cannot be a `gh pr create`, so the
// dispatcher skips importing this hook entirely.
export const triggers: readonly string[] = ['gh']

// Network budget for the ONE `gh pr list` probe. Deliberately NOT run through
// `spawnTimeoutMs` — that helper scales a LOCAL process spawn for win32, and
// its own doc bars wrapping a network call, which must stay bounded so a
// GitHub blackout can't hang the PreToolUse hook. A killed probe reads as an
// error, and an error fails OPEN.
const GH_PR_LIST_TIMEOUT_MS = 10_000

/**
 * An open PR already occupying a head/base pair.
 */
export interface OpenPr {
  readonly number: number
  readonly url: string
}

/**
 * The head/base/repo a `gh pr create` would open a PR for.
 */
export interface PrTarget {
  // The base branch: explicit `--base`/`-B`, else the resolved default.
  readonly base: string
  // The directory the command runs in, so `gh` resolves the right repo.
  readonly cwd: string
  // The head branch, owner prefix stripped.
  readonly head: string
  // An explicit `--repo`/`-R` slug, or '' when gh should infer it from cwd.
  readonly repo: string
}

/**
 * The explicit `--base` / `-B` value of a `gh pr create`, or undefined when the
 * command carries no base flag.
 */
export function baseBranchFlag(command: string): string | undefined {
  const c = ghPrCreateCommand(command)
  return c ? flagValue(c.args, '--base', '-B') : undefined
}

/**
 * The explicit `--head` / `-H` value, owner prefix stripped, or undefined.
 */
export function headBranchFlag(command: string): string | undefined {
  const c = ghPrCreateCommand(command)
  if (!c) {
    return undefined
  }
  const raw = flagValue(c.args, '--head', '-H')
  return raw === undefined ? undefined : stripOwnerPrefix(raw)
}

/**
 * Everything the duplicate lookup needs, or undefined when the command is not
 * a `gh pr create` or the head branch can't be resolved (detached HEAD, not a
 * repo) — both of which mean this guard has no question to ask.
 */
export function resolvePrTarget(
  command: string,
  hookCwd: string | undefined,
): PrTarget | undefined {
  if (!isGhPrCreate(command)) {
    return undefined
  }
  const cwd = extractGitCwd(command, { cwd: hookCwd })
  const head = headBranchFlag(command) ?? currentBranch(cwd)
  if (!head) {
    return undefined
  }
  const c = ghPrCreateCommand(command)
  return {
    base: baseBranchFlag(command) ?? resolveDefaultBranch(cwd),
    cwd,
    head,
    repo: c ? ghExplicitRepoArg(c.args) : '',
  }
}

/**
 * The OPEN PR already occupying `target`'s head/base pair, or undefined when
 * there is none — AND on every failure path (gh missing, unauthenticated, not
 * a repo, network timeout, unparseable JSON). Fail-open is the whole contract:
 * the guard prevents churn, it must never be the reason work stops.
 */
export function findOpenPrForHead(target: PrTarget): OpenPr | undefined {
  const args = [
    'pr',
    'list',
    '--head',
    target.head,
    '--base',
    target.base,
    '--state',
    'open',
    '--json',
    'number,url',
  ]
  if (target.repo) {
    args.push('--repo', target.repo)
  }
  const r = spawnSync('gh', args, {
    cwd: target.cwd,
    timeout: GH_PR_LIST_TIMEOUT_MS,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) {
    return undefined
  }
  for (let i = 0, { length } = parsed; i < length; i += 1) {
    const row = parsed[i] as
      | { number?: unknown | undefined; url?: unknown | undefined }
      | undefined
    if (typeof row?.number === 'number' && typeof row.url === 'string') {
      return { number: row.number, url: row.url }
    }
  }
  return undefined
}

/**
 * The operator-facing block message.
 */
export function blockMessage(target: PrTarget, existing: OpenPr): string {
  return (
    [
      '[no-duplicate-pr-guard] Refusing to open a second PR for a branch that already has one.',
      '',
      `  What:  gh pr create would open a NEW PR for head "${target.head}" into base "${target.base}",`,
      `         but PR #${existing.number} is ALREADY OPEN for exactly that head and base.`,
      `  Open:  ${existing.url}`,
      '  Fix:   Put the work on the PR that exists instead of stacking another beside it —',
      `           gh pr edit ${existing.number} --title <title> --body-file <file>`,
      '           git push   # new commits land on the open PR on their own',
      '',
      '  Why: two PRs for one branch split the review, orphan the CI history, and',
      '  invite a "close the loser" cleanup — and GitHub does not reliably let you',
      '  reopen a closed PR (reopenPullRequest can refuse outright), so that close',
      '  is effectively permanent. Reworking a PR means pushing to its branch.',
      '',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard(
  (command: string, payload: ToolCallPayload): GuardResult => {
    const target = resolvePrTarget(command, payload.cwd)
    if (!target) {
      return undefined
    }
    const existing = findOpenPrForHead(target)
    if (!existing) {
      return undefined
    }
    return block(blockMessage(target, existing))
  },
)

export const hook = defineHook({
  bypass: ['duplicate-pr'],
  // Low-risk: the worst case of a wrong block is one extra PR that had to be
  // opened by hand, and GitHub itself is the final arbiter of PR state.
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
