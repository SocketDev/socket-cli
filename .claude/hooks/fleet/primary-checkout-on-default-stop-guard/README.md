# primary-checkout-on-default-stop-guard

Stop hook. Blocks turn-end when the **primary checkout** is on a non-default
branch.

Companion to `primary-checkout-branch-guard` (PreToolUse). That guard blocks a
`git checkout`/`git switch` typed as a Bash command; this one catches the
*result* at turn-end regardless of source — a checkout run inside a script, a
Makefile target, or any tool that shells git internally slips past PreToolUse,
but this lock reads the actual on-disk branch and blocks if the primary drifted
off its default.

- **Primary only.** A linked worktree, whose `.git` is a file, is the sanctioned
  home for feature branches and is never blocked.
- **Fleet only.** A non-fleet solo repo has no shared-checkout hazard.
- **Fix:** `git switch <default>` (switching *to* the default branch in the
  primary is allowed); move feature work into a worktree.
- **Bypass:** `Allow off-default bypass`.
