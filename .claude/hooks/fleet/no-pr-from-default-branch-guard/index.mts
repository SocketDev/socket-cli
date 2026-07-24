#!/usr/bin/env node
// Claude Code PreToolUse hook — no-pr-from-default-branch-guard.
//
// HARD-BLOCKS `gh pr create` when the PR's HEAD branch is the repository's
// default branch (main / master / the resolved origin/HEAD default). Opening a
// PR whose head is the default branch is a hard error — you PR from a feature
// branch, never from main/master. This is the blocking (exit 2) twin of the
// advisory pr-vs-push-default-nudge (a reminder about push-vs-PR).
//
// Universal safety: fires in NON-fleet repos too — the motivating incident was
// a PR opened against an external repo — so it is NOT gated on fleet membership.
//
// The PR head is computed structurally: an explicit `--head` / `-H` value
// (owner prefix stripped) wins; otherwise the current checkout's branch. The
// `gh pr create` detection uses the shell-quote-backed shell-command.mts parser,
// NEVER a raw regex on the command string, so `&&` chains, quoting, and `$(…)`
// substitution are handled and a literal "gh pr create" inside a grep string
// can't false-fire.
//
// Bypass: `Allow pr-from-default-branch bypass` in a recent user turn.

import { ghPrCreateCommand, isGhPrCreate } from '../_shared/gh-pr-command.mts'
import { currentBranch, resolveDefaultBranch } from '../_shared/git-branch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { flagValue } from '../_shared/shell-command.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

// The `gh pr create` detection is the shared parser-backed one; re-exported
// so this guard's tests exercise the exact predicate the check runs.
export { ghPrCreateCommand, isGhPrCreate }

// The explicit `--head` / `-H` branch (owner prefix stripped), or undefined
// when the command carries no head flag.
export function headBranchFlag(command: string): string | undefined {
  const c = ghPrCreateCommand(command)
  if (!c) {
    return undefined
  }
  const raw = flagValue(c.args, '--head', '-H')
  return raw === undefined ? undefined : stripOwnerPrefix(raw)
}

// True when `head` is a default-branch name — the repo's resolved default, or a
// literal `main`/`master` regardless of what origin/HEAD points at.
export function isDefaultHead(head: string, defaultBranch: string): boolean {
  return head === defaultBranch || head === 'main' || head === 'master'
}

// The PR head branch: the explicit `--head`/`-H` value when present, else the
// current checkout's branch. Undefined when neither can be resolved.
export function resolvePrHead(
  command: string,
  cwd: string,
): string | undefined {
  return headBranchFlag(command) ?? currentBranch(cwd)
}

// Strip a `<owner>:` prefix from a `--head` value (`me:feat/x` → `feat/x`). A
// bare branch is returned unchanged.
export function stripOwnerPrefix(head: string): string {
  const idx = head.indexOf(':')
  return idx === -1 ? head : head.slice(idx + 1)
}

export const hook = defineHook({
  bypass: ['pr-from-default-branch'],
  bypassOptional: true,
  check: bashGuard((command, payload) => {
    if (!isGhPrCreate(command)) {
      return undefined
    }
    const cwd = resolveProjectDir(payload.cwd)
    const head = resolvePrHead(command, cwd)
    if (!head) {
      return undefined
    }
    const defaultBranch = resolveDefaultBranch(cwd)
    if (!isDefaultHead(head, defaultBranch)) {
      return undefined
    }
    return block(
      [
        '[no-pr-from-default-branch-guard] Refusing to open a PR whose head is the default branch.',
        '',
        `  What:  gh pr create would open a PR FROM the default branch (head: ${head}).`,
        `  Where: ${cwd}  (default branch: ${defaultBranch})`,
        '  Fix:   PR from a FEATURE branch, never from the default branch —',
        '           git switch -c <feature-branch>',
        '           # then re-run gh pr create',
        '         or target an explicit feature head:',
        '           gh pr create --head <owner>:<feature-branch>',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
