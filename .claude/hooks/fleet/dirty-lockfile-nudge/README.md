# dirty-lockfile-nudge

**Type:** PostToolUse reminder (Bash) — nudges, never blocks.

**Trigger:** a Bash command that ran `git` or `pnpm`, AND `git status
--porcelain` shows a modified / staged / renamed `pnpm-lock.yaml`
anywhere in the tree.

**Why:** a dependency edit (`package.json`), a workspace-shape change (a
hook renamed or added under `.claude/hooks/`), or a cascade leaves
`pnpm-lock.yaml` out of sync with the manifests. Committing the stale
pair makes CI's `pnpm install --frozen-lockfile` reject the push — a
local-passes / CI-fails trap. `pnpm i` regenerates the lockfile so it
matches again.

**Action:** prints a reminder to run `pnpm i` to reconcile, then commit
the regenerated lockfile alongside the change. Does NOT run the install
itself (`pnpm i` hits the network/Socket Firewall and may run build
scripts — too heavy to fire blind from a fast hook); the agent runs the
named command. Does not suggest hand-editing the lockfile or committing
the stale pair.

**Command gate:** the `git`/`pnpm` check (via the shared `commandsFor`
AST parser, not a regex) keeps it quiet — a non-git/non-pnpm Bash call
never triggers a `git status` probe.

**Distinct from [`stale-node-modules-nudge`](../stale-node-modules-nudge/):**
that one reacts to a `Cannot find package` resolution error in command
OUTPUT — a dangling pnpm symlink after a worktree removal. This one
reacts to a dirty lockfile in `git status` (a reconcile-needed drift).
Different signal, different fix surface.

**Bypass:** none — informational only (exit 0).
