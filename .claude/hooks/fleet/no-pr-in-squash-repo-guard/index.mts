#!/usr/bin/env node
// Claude Code PreToolUse hook — no-pr-in-squash-repo-guard.
//
// Blocks `gh pr create` in a squash-history repo. These repos land work by
// pushing to main; they do not review through pull requests.
//
// Why this exists: an agent spent a long session treating this repo as
// PR-based — opened a PR, then fought the consequences. In a trunk repo
// with a fast-moving main and an auto-committing cascade gate, a feature
// branch goes stale within minutes, so the PR accumulated unrelated
// cascade commits, needed the cascade split back out onto main, was
// rebuilt twice against a moving target, and failed two checks purely
// from staleness (`wheelhouse-controlled-files-are-classified`,
// `bootstrap`) that passed the moment the branch was current. None of
// that work existed for any reason except the PR.
//
// The signals were all there and none of them said "PR": the pre-push
// gate auto-commits cascades, refuses a push that "would publish a stale
// live tree to the whole fleet", and teaches `git push --no-verify
// origin HEAD:main` as the sanctioned way through in-flight drift. That
// is a trunk-based repo describing itself. This guard makes the
// convention refuse rather than merely be inferable.
//
// What it DENIES:
//   - gh pr create …            (in a squash-history repo)
//
// What it ALLOWS (never over-block):
//   - gh pr create in any NON-squash-history repo — most fleet members
//     and every external repo are PR-based, and this must not touch them
//   - gh pr view/list/checks/comment/edit/close/merge — reading and
//     responding to PRs is normal even here (a bot or an outside
//     contributor can still open one)
//   - git push, gh release, any non-`pr create` command
//
// Bypass: `Allow pr in squash repo`, typed by the HUMAN in a genuine
// user turn — an agent cannot self-authorize (same provenance rule as
// push-protected-branch-guard).

import { isSquashHistoryRepo } from '../../../../.git-hooks/_shared/push-squash-history.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { GH_VALUE_FLAGS, positionalArgs } from '../_shared/positional-args.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const NAME = 'no-pr-in-squash-repo-guard'

export const triggers: readonly string[] = ['pr']

// `gh pr create` only. Subcommands that read or respond to an existing PR
// stay allowed: a bot or an outside contributor can still open one here,
// and refusing to look at it would be worse than the problem.
export function isGhPrCreate(argv: readonly string[]): boolean {
  if (argv[0] !== 'gh') {
    return false
  }
  // Shared parse, not a local flag filter: `gh --repo o/r pr create` reads
  // as `['o/r', 'pr', …]` under the naive form and stops matching. Limit 2
  // — only the first two words can be `pr create`, and stopping there keeps
  // a later free-text value (a --body reading "pr create") out of the scan.
  const words = positionalArgs(argv.slice(1), GH_VALUE_FLAGS, 2)
  return words[0] === 'pr' && words[1] === 'create'
}

const check = bashGuard(command => {
  const commands = parseCommands(command)
  const creating = commands.some(cmd => isGhPrCreate([cmd.binary, ...cmd.args]))
  if (!creating || !isSquashHistoryRepo()) {
    return undefined
  }
  return block(
    `[${NAME}] ` +
      [
        'Refusing `gh pr create` — this is a squash-history repo: work lands by',
        'pushing to main, not through pull requests.',
        '',
        'A PR here is not just unnecessary, it is actively costly. main moves',
        'constantly and the cascade gate auto-commits, so a feature branch goes',
        'stale within minutes: it collects unrelated cascade commits, fails',
        'checks purely from staleness, and needs rebuilding against a moving',
        'target. That is work the PR itself created.',
        '',
        'Do instead:',
        '  git add -A && git commit -m "…"',
        '  git push origin HEAD:main',
        '',
        'If the push gate blocks on in-flight WIP or cascade/format drift from a',
        'parallel session (not a real regression), that is expected — local main',
        'is canonical and flattens:',
        '  git add -A && git commit --no-verify -m "chore: …"',
        '  pnpm run dogfood',
        '  git push --no-verify origin HEAD:main',
        '',
        'Reading and responding to an existing PR (view/list/checks/comment) is',
        'always allowed — a bot or outside contributor can still open one.',
      ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['pr-in-squash-repo'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
