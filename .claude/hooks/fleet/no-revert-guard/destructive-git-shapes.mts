/*
 * @file The `git` shapes no-revert-guard's work-loss rule blocks, and the rule
 *   LABEL derived from them. One list, so the message can never describe a
 *   different set of commands than the matcher checks.
 *
 *   `git revert` is deliberately NOT here. It appends an inverse commit and
 *   discards nothing: the working tree keeps every uncommitted change, the
 *   reverted commit stays reachable, and the whole thing undoes with another
 *   revert. No work is lost, so it does not belong in a rule that gates on
 *   work loss and fires in every repo, fleet or not. The fleet's position on
 *   `git revert` is a NUDGE instead — prefer-rebase-over-revert-nudge steers an
 *   unpushed commit to `git reset --soft` / `git rebase -i`, which is the right
 *   severity for a reversible, additive operation.
 *
 *   The guard's NAME still reads `no-revert-guard`. "revert" there names the
 *   category rather than the subcommand: every shape below puts tracked work
 *   back, and the bypass phrase is keyed to that name.
 */

/**
 * Every `git` subcommand a destructive shape keys on, sorted. The rule label is
 * built from this list, and the specs assert the list and
 * {@link destructiveGitShape} agree in both directions: every entry has a shape
 * that matches, and no subcommand outside the list ever does.
 */
export const DESTRUCTIVE_GIT_SUBCOMMANDS: readonly string[] = [
  'checkout',
  'clean',
  'reset',
  'restore',
  'rm',
  'stash',
]

/**
 * The work-loss rule's human-readable label, logged on rejection. Derived from
 * {@link DESTRUCTIVE_GIT_SUBCOMMANDS} so it names exactly what gets blocked.
 */
export const DESTRUCTIVE_GIT_RULE_LABEL = `discards tracked work (git ${DESTRUCTIVE_GIT_SUBCOMMANDS.join('/')})`

/**
 * The destructive label for ONE reading of a git segment, or undefined. Takes a
 * parsed git command's args: `sub` is the subcommand, `rest` is everything
 * after it. What each covered shape destroys:
 *
 * - `checkout … -- <path>` and `checkout .` discard working-tree changes.
 * - `clean -f` / `--force` / `-xf` / `-df` erases untracked files.
 * - `reset --hard` discards the working tree and the index.
 * - `restore <path>` discards working-tree changes. `restore --staged` only
 *   unstages, so it is not covered.
 * - `rm -f` / `-rf` erases tracked files.
 * - `stash clear` / `drop` / `pop` destroys or consumes a stash entry.
 */
export function destructiveGitShape(
  sub: string | undefined,
  rest: readonly string[],
): string | undefined {
  if (!sub) {
    return undefined
  }
  // Both discard the working tree: `git checkout -- <path>` (explicit
  // pathspec) and `git checkout .`, bare-dot pathspec. A pathspec-less
  // `git checkout <branch>` is a SWITCH, not a discard — left to
  // primary-checkout-branch-guard — so we key on `--` or a `.` arg.
  if (sub === 'checkout' && (rest.includes('--') || rest.includes('.'))) {
    return rest.includes('.') ? 'git checkout .' : 'git checkout -- <path>'
  }
  if (sub === 'restore' && !rest.includes('--staged')) {
    return 'git restore'
  }
  if (sub === 'reset' && rest.includes('--hard')) {
    return 'git reset --hard'
  }
  if (
    sub === 'stash' &&
    (rest[0] === 'clear' || rest[0] === 'drop' || rest[0] === 'pop')
  ) {
    return `git stash ${rest[0]}`
  }
  // Force flag in any form: short `-f`/`-xf`/`-df` (the `/^-[a-z]*f/`
  // bundle) OR long `--force`. The long form slips the short-flag regex
  // (`--force` has no `f` in the `-[a-z]*` run), so test it explicitly —
  // `git clean --force -d` wipes untracked files just like `git clean -fd`.
  // Dry-run (`-n`/`--dry-run`) carries no force flag, so it stays allowed.
  if (
    sub === 'clean' &&
    rest.some(a => /^-[a-z]*f/.test(a) || a.startsWith('--force'))
  ) {
    return 'git clean -f'
  }
  if (sub === 'rm' && rest.some(a => /^-r?f?$/.test(a) && a.includes('f'))) {
    return 'git rm -f'
  }
  return undefined
}
