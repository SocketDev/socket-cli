#!/usr/bin/env node
// Claude Code PreToolUse hook — no-chained-pausing-git-guard.
//
// Blocks one Bash call that chains a PAUSING git operation (rebase,
// merge, cherry-pick, am, revert, stash pop/apply) ahead of another git
// MUTATION in the same command line.
//
// Why this exists: a pausing op does not finish when it hits a conflict
// — it stops mid-flight, leaves HEAD detached, and prints the
// resolution instructions. Chained, two things then go wrong at once:
// with `;` the next command runs anyway, and with `| tail`/`| grep` the
// instructions are swallowed, so the failure is invisible. A real
// incident: `git rebase origin/main 2>&1 | tail -1; git push --no-verify
// origin HEAD:main` — the rebase stopped on a conflict, its output was
// eaten by the pipe, and the push ran against a DETACHED HEAD, where it
// reported "Everything up-to-date" while six commits sat unpushed. A
// silent no-op that reads like success is the worst possible outcome for
// a state-changing command.
//
// The rule is not "never chain git". Chaining read-only git (status,
// log, diff, rev-parse) is how you keep a turn cheap, and even
// `git commit && git push` is fine: commit either succeeds or fails
// cleanly, and `&&` respects that. Only the ops that can PAUSE are the
// hazard, because their failure mode is a half-finished repository
// rather than a nonzero exit.
//
// DENIES (pausing op + a later git mutation, any separator):
//   - git rebase … ; git push …
//   - git rebase … && git push …
//   - git merge … && git commit …
//   - git cherry-pick … ; git reset …
//
// ALLOWS:
//   - git rebase … alone (run it, read it, then act)
//   - git rebase … && git status / git log  (reads after)
//   - git commit … && git push …            (neither op pauses)
//   - git fetch && git rebase …             (fetch cannot pause)
//   - any single git command, however piped
//
// Bypass: `Allow chained git bypass`, typed by the human in a genuine
// user turn.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { GIT_VALUE_FLAGS, positionalArgs } from '../_shared/positional-args.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const NAME = 'no-chained-pausing-git-guard'

export const triggers: readonly string[] = [
  'rebase',
  'merge',
  'cherry-pick',
  'am',
  'revert',
]

// Ops that can stop mid-flight and leave the repo in a resolve-me state.
export const PAUSING_OPS: ReadonlySet<string> = new Set([
  'am',
  'cherry-pick',
  'merge',
  'rebase',
  'revert',
])

// Ops that write refs or the worktree. A pausing op ahead of one of
// these is what turns a stalled rebase into a wrong write.
export const MUTATING_OPS: ReadonlySet<string> = new Set([
  'am',
  'branch',
  'checkout',
  'cherry-pick',
  'commit',
  'merge',
  'push',
  'rebase',
  'reset',
  'revert',
  'stash',
  'switch',
  'tag',
])

/**
 * The git subcommand of a parsed command, or '' when it is not git.
 */
export function gitSubcommand(binary: string, args: readonly string[]): string {
  if (binary !== 'git') {
    return ''
  }
  return positionalArgs(args, GIT_VALUE_FLAGS, 1)[0] ?? ''
}

/**
 * Index of the first pausing op that is followed by a later mutation.
 * `stash` only pauses on pop/apply, so it is judged by its own second
 * word rather than by name alone.
 */
export function findChainedPause(
  commands: ReadonlyArray<{ binary: string; args: readonly string[] }>,
): { pausing: string; mutating: string } | undefined {
  for (let i = 0; i < commands.length; i += 1) {
    const cmd = commands[i]
    if (!cmd) {
      continue
    }
    const sub = gitSubcommand(cmd.binary, cmd.args)
    // `--abort` / `--quit` TERMINATE an in-progress operation; they cannot
    // leave the repo half-done, and chaining them is how you recover
    // (`git rebase --abort && git checkout main`). Blocking recovery — the
    // command reached for when already stuck — is worse than the hazard.
    // `--continue` / `--skip` stay in scope: they re-enter the operation
    // and can stop on the next conflict.
    const terminates = cmd.args.some(a => a === '--abort' || a === '--quit')
    const pauses =
      !terminates &&
      (PAUSING_OPS.has(sub) ||
        (sub === 'stash' &&
          ['pop', 'apply'].includes(
            positionalArgs(cmd.args, GIT_VALUE_FLAGS, 2)[1] ?? '',
          )))
    if (!pauses) {
      continue
    }
    for (let j = i + 1; j < commands.length; j += 1) {
      const later = commands[j]
      if (!later) {
        continue
      }
      const laterSub = gitSubcommand(later.binary, later.args)
      if (MUTATING_OPS.has(laterSub)) {
        return { mutating: `git ${laterSub}`, pausing: `git ${sub}` }
      }
    }
  }
  return undefined
}

const check = bashGuard(command => {
  const found = findChainedPause(parseCommands(command))
  if (!found) {
    return undefined
  }
  return block(
    [
      `[${NAME}] Refusing to chain \`${found.mutating}\` after \`${found.pausing}\` in one command.`,
      '',
      `\`${found.pausing}\` can stop MID-FLIGHT on a conflict: it leaves HEAD`,
      'detached and prints the resolution steps. Chained, both halves of that',
      'go wrong — `;` runs the next command anyway, and a `| tail` / `| grep`',
      'swallows the instructions — so the repo is half-rebased while the next',
      'write lands somewhere unintended. A push in that state reports',
      '"Everything up-to-date" and silently pushes nothing.',
      '',
      'Run them as separate calls, and read the first result before the second:',
      `  ${found.pausing} …            # unpiped, so conflicts are visible`,
      `  ${found.mutating} …           # only after confirming the first finished`,
      '',
      'Chaining read-only git (status, log, diff, rev-parse) is fine, and so',
      'is `git commit && git push` — neither of those can pause.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['chained-git'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
