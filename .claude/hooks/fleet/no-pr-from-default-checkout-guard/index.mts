#!/usr/bin/env node
// Claude Code PreToolUse hook — no-pr-from-default-checkout-guard.
//
// HARD-BLOCKS `gh pr create` when the current working directory's checkout is
// sitting on its default branch (current branch === main / master / the
// resolved origin/HEAD default) — EVEN IF `--head` names a feature branch on
// another repo. Running `gh pr create` from a checkout on the default branch is
// the mistake that causes thrash: you must run it from the feature-branch
// worktree. This inspects where the command is RUN FROM; its sibling
// no-pr-from-default-branch-guard inspects the PR HEAD.
//
// Universal safety: fires in NON-fleet repos too — the motivating incident was
// an external PR — so it is NOT gated on fleet membership. The `gh pr create`
// detection uses the shell-quote-backed shell-command.mts parser, NEVER a raw
// regex, so `&&` chains, quoting, and `$(…)` substitution are handled and a
// literal "gh pr create" inside a grep string can't false-fire.
//
// Bypass: `Allow pr-from-default-checkout bypass` in a recent user turn.

import process from 'node:process'

import { originOwnerRepo } from '../_shared/fleet-repos.mts'
import { ghPrCreateCommands, isGhPrCreate } from '../_shared/gh-pr-command.mts'
import { currentBranch, resolveDefaultBranch } from '../_shared/git-branch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { flagValue } from '../_shared/shell-command.mts'

// The `gh pr create` detection is the shared parser-backed one; re-exported
// so this guard's tests exercise the exact predicate the check runs.
export { isGhPrCreate }

// The explicit `--repo <value>` / `--repo=<value>` / `-R <value>` target of a
// `gh pr create` in `command`, or undefined when gh would infer the repo from
// the checkout.
export function explicitRepoTarget(command: string): string | undefined {
  for (const c of ghPrCreateCommands(command)) {
    const value = flagValue(c.args, '--repo', '-R')
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

// Case-insensitive `owner/repo` equality between an explicit `--repo` value
// (OWNER/REPO, HOST/OWNER/REPO, or a full URL) and a checkout's origin slug.
export function sameOwnerRepo(target: string, origin: string): boolean {
  const tail = target
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('/')
  return tail.toLowerCase() === origin.toLowerCase()
}

// True when `branch` is a default-branch checkout — the repo's resolved
// default, or a literal `main`/`master` regardless of what origin/HEAD points
// at (a fresh clone with no origin/HEAD still counts).
export function isDefaultCheckout(
  branch: string,
  defaultBranch: string,
): boolean {
  return branch === defaultBranch || branch === 'main' || branch === 'master'
}

export const hook = defineHook({
  bypass: ['pr-from-default-checkout'],
  bypassOptional: true,
  check: bashGuard((command, payload) => {
    if (!isGhPrCreate(command)) {
      return undefined
    }
    const cwd = payload.cwd ?? process.cwd()
    // An explicit `--repo` naming a DIFFERENT repository than this checkout's
    // origin means the cwd checkout is not the PR's source — its branch is
    // irrelevant (the sibling no-pr-from-default-branch-guard still vets the
    // PR head). Only same-repo (or repo-less) invocations are the
    // wrong-checkout mistake this guard exists to stop.
    const explicitRepo = explicitRepoTarget(command)
    if (explicitRepo) {
      const origin = originOwnerRepo(cwd)
      if (origin && !sameOwnerRepo(explicitRepo, origin)) {
        return undefined
      }
    }
    const branch = currentBranch(cwd)
    if (!branch) {
      return undefined
    }
    const defaultBranch = resolveDefaultBranch(cwd)
    if (!isDefaultCheckout(branch, defaultBranch)) {
      return undefined
    }
    return block(
      [
        '[no-pr-from-default-checkout-guard] Refusing to open a PR from a checkout on the default branch.',
        '',
        '  What:  gh pr create is running from a checkout sitting on the default branch.',
        `  Where: ${cwd}  (current branch: ${branch} === default: ${defaultBranch})`,
        '  Fix:   Run gh pr create from the FEATURE-branch worktree, not a',
        '         default-branch checkout —',
        '           git switch -c <feature-branch>   # or cd into the feature worktree',
        '           # then re-run gh pr create',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
