#!/usr/bin/env node
// Claude Code PreToolUse hook — history-rewrite-guard.
//
// BLOCKS a raw history-rewrite invocation in a fleet repo and routes to the
// sanctioned path. Three shapes, all of them mint commits that a
// signature-required branch rejects:
//
//   1. `git filter-branch` — re-creates every commit WITHOUT a signature, and
//      restores the original `GIT_COMMITTER_NAME`/`_EMAIL`/`_DATE`. Both
//      defects bit live (socket-mcp, 2026-07-28): a `--msg-filter` run left 26
//      unsigned commits that only `check`'s `commits-are-signed` caught, and
//      re-signing with `--commit-filter 'git commit-tree -S "$@"'` still failed
//      GitHub verification on the two commits whose restored committer was a
//      noreply address — "Commits must have verified signatures. Found 2
//      violations."
//   2. `git filter-repo` (and the standalone `git-filter-repo` binary) — same
//      re-mint, same unsigned result.
//   3. `git commit-tree` with no signing flag — the plumbing that mints a
//      commit object directly. Without `-S`/`--gpg-sign` the object is
//      unsigned the moment it exists.
//
// The correct shape — author identity and author date preserved, committer
// left to default to whoever runs the rewrite, `-S` to sign — is what
// `git rebase` does naturally and what
// `scripts/fleet/strip-ai-attribution.mts` implements with plumbing.
//
// Deliberately NOT caught, each for a stated reason:
//   - An ordinary `git rebase`. It is the most common git command in the fleet
//     and it signs through the repo's normal config. A guard that fired on it
//     would be turned off within a day, and then it would protect nothing.
//   - `--no-gpg-sign` / `commit.gpgsign=false`. Already owned by
//     `no-revert-guard` under its own bypass. One surface per concern — a
//     `commit-tree --no-gpg-sign` therefore falls through to that guard rather
//     than double-blocking here.
//   - A scripted-editor `git rebase` reword (`GIT_SEQUENCE_EDITOR=…`). Owned
//     by the sibling `attribution-rewrite-nudge`, which NUDGES because a
//     scripted-editor rebase has legitimate non-rewrite uses. This guard
//     BLOCKS because `filter-branch`/`filter-repo` have no safe fleet use.
//   - A many→1 force push (`no-total-squash-guard`) and force-push shape
//     generally (`no-force-push-guard`).
//
// Fails open on parse / payload errors and outside a fleet repo — a guard bug
// must not wedge every Bash call.

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { gitSubcommand } from '../_shared/git-subcommand.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'

export const triggers: readonly string[] = [
  'commit-tree',
  'filter-branch',
  'filter-repo',
]

// The rewrite shape a command was caught on.
export type HistoryRewriteKind =
  | 'filter-branch'
  | 'filter-repo'
  | 'unsigned-commit-tree'

export interface HistoryRewriteDetection {
  readonly kind: HistoryRewriteKind
  // The offending invocation, re-joined for the "Where" line.
  readonly invocation: string
}

/**
 * True when the args carry a GPG signing flag: `-S`, `-S<keyid>`,
 * `--gpg-sign`, or `--gpg-sign=<keyid>`.
 */
export function hasSigningFlag(args: readonly string[]): boolean {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--gpg-sign' || arg.startsWith('--gpg-sign=')) {
      return true
    }
    if (arg !== '--' && !arg.startsWith('--') && arg.startsWith('-S')) {
      return true
    }
  }
  return false
}

/**
 * True when the args explicitly disable signing. Such a command belongs to
 * `no-revert-guard` (`--no-gpg-sign` is its concern, with its own bypass), so
 * this guard stands down rather than blocking the same command twice.
 */
export function optsOutOfSigning(args: readonly string[]): boolean {
  return args.includes('--no-gpg-sign')
}

/**
 * True when the invocation only asks git for documentation. `git filter-branch
 * --help` rewrites nothing.
 */
export function isHelpQuery(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h')
}

/**
 * Find a raw history-rewrite invocation in a shell command line. Tokenized via
 * the shared parser, so chains, `$(…)` substitution, and quoting are handled
 * and a `filter-branch` mention inside a grep pattern or a commit message
 * never false-fires.
 */
export function detectHistoryRewrite(
  command: string,
): HistoryRewriteDetection | undefined {
  let parsed
  try {
    parsed = parseCommands(command)
  } catch {
    return undefined
  }
  for (const cmd of parsed) {
    const { args, binary } = cmd
    /* c8 ignore next - defensive: split always yields at least one segment */
    const name = binary.split('/').pop() ?? ''
    if (isHelpQuery(args)) {
      continue
    }
    // The standalone `git-filter-repo` executable, invoked directly rather
    // than as a `git` subcommand.
    if (name === 'git-filter-repo') {
      return {
        invocation: [name, ...args].join(' '),
        kind: 'filter-repo',
      }
    }
    if (name !== 'git') {
      continue
    }
    const sub = gitSubcommand(args)
    if (sub === 'filter-branch' || sub === 'filter-repo') {
      return {
        invocation: ['git', ...args].join(' '),
        kind: sub,
      }
    }
    if (
      sub === 'commit-tree' &&
      !hasSigningFlag(args) &&
      !optsOutOfSigning(args)
    ) {
      return {
        invocation: ['git', ...args].join(' '),
        kind: 'unsigned-commit-tree',
      }
    }
  }
  return undefined
}

const WHAT: Record<HistoryRewriteKind, string> = {
  __proto__: null,
  'filter-branch':
    '`git filter-branch` re-mints history unsigned and keeps the original committer.',
  'filter-repo': '`git filter-repo` re-mints history unsigned.',
  'unsigned-commit-tree':
    '`git commit-tree` with no signing flag mints an unsigned commit.',
} as Record<HistoryRewriteKind, string>

const WANTED: Record<HistoryRewriteKind, string> = {
  __proto__: null,
  'filter-branch':
    'every re-minted commit signed, with the committer left to default',
  'filter-repo':
    'every re-minted commit signed, with the committer left to default',
  'unsigned-commit-tree': 'the minted commit signed with `-S`',
} as Record<HistoryRewriteKind, string>

export function formatBlock(detection: HistoryRewriteDetection): string {
  const { invocation, kind } = detection
  const lines = [
    `[history-rewrite-guard] Blocked: ${WHAT[kind]}`,
    '',
    `  Where:  ${invocation}`,
    '  Saw:    a raw history rewrite, run by hand.',
    `  Wanted: ${WANTED[kind]}.`,
    '',
    '  Why: a re-minted commit carries no signature unless you ask for one,',
    '  and `filter-branch` additionally RESTORES the original',
    '  GIT_COMMITTER_NAME / GIT_COMMITTER_EMAIL / GIT_COMMITTER_DATE. On a',
    '  branch whose ruleset requires verified signatures that fails twice: the',
    '  unsigned commits are rejected, and re-signing them still fails when your',
    '  signature disagrees with the restored committer field.',
    '',
    '  Fix — stripping AI attribution, or any message rewrite across a range:',
    '',
    '    node scripts/fleet/strip-ai-attribution.mts --base <ref> [--dry-run]',
    '',
    '  It rewords only flagged messages, preserves the tree, author identity,',
    '  and author date, signs each commit, and verifies the final tree',
    '  byte-identical before moving HEAD.',
    '',
    '  Fix — any other rewrite: use `git rebase` (or `git commit-tree`) and',
    '  hold both invariants:',
    '',
    '    1. Sign every re-minted commit — pass `-S`.',
    '    2. Let the committer DEFAULT to whoever runs the rewrite. Set only',
    '       GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL / GIT_AUTHOR_DATE; never',
    '       restore GIT_COMMITTER_*.',
    '',
    '  Detail: docs/agents.md/fleet/history-rewrites.md',
  ]
  return lines.join('\n') + '\n'
}

export const check = bashGuard((command, payload) => {
  const detection = detectHistoryRewrite(command)
  if (!detection) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  return block(formatBlock(detection))
})

export const hook = defineHook({
  bypass: ['history-rewrite'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
