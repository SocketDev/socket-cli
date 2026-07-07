# land-fast-nudge

Stop hook. Nudges at turn-end when the checkout is on the default branch
(main / master) and local HEAD has **diverged** from origin — it is BOTH
ahead AND behind `origin/<branch>`.

A diverged default branch is the state where a direct `git push` is
rejected and a `reset --hard` would discard local work. In a
parallel-session fleet it happens routinely: another session squashes your
commits onto origin via PR while your local keeps the unsquashed
originals. Rather than hand-roll a cherry-pick + force, the reminder points
at the `managing-worktrees land` engine
(`.claude/skills/fleet/managing-worktrees/lib/land.mts`): it re-asserts the
lint gate (the fleet lints as it edits — no heavy re-run), cherry-picks the
local-only commits onto a throwaway `origin/<base>` worktree, and
fast-forwards (never force).

Only fires when BOTH ahead AND behind — ahead-only is the
`unpushed-main-nudge`'s job, behind-only just needs a pull.

Fails open: any hook error is swallowed so a reminder bug never disrupts
the turn.
