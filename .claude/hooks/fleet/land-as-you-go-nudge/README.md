# land-as-you-go-nudge

PostToolUse hook, non-blocking. After a successful `git commit` on the
default branch it counts the local commits not yet on origin, and at three or
more it nudges to land the queue — push, or the managing-worktrees land flow
— before the next chunk starts. The commit-time twin of
`unpushed-main-nudge`: that one reminds at turn end; this one fires in the
moment the queue grows, when landing is one command and the context is still
loaded.

- **Trigger:** PostToolUse on Bash commands whose parsed argv contains a
  `git commit` invocation (honoring `git -C <dir>`); matching is on argv
  words, so `commit` inside a message or path never counts.
- **Verdict:** a stderr notice at queue depth ≥ 3; silent off the default
  branch (worktree branches land as a unit), silent without an
  `origin/<branch>` counterpart, silent below the threshold.
- **Why:** an unpushed pile is fragile in a parallel-session fleet — squash
  cadences and repair flows move origin under it, and every extra commit
  widens the eventual conflict surface.

Companions: `unpushed-main-nudge` (turn-end reminder),
`commit-size-nudge` (per-commit line budget), `land-fast-nudge` (diverged
default branch routes to the land engine).
