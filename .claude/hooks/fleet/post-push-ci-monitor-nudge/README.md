# post-push-ci-monitor-nudge

**Type:** PostToolUse reminder (Bash) — nudges, never blocks.

**Trigger:** a Bash command that ran a real `git push` — a `git` segment
whose first non-flag argument is `push`, excluding a `--dry-run` / `-n`
push (which contacts no remote and triggers no CI).

**Why:** pushing to origin/main fans out to the whole fleet — members
cascade from origin/main, so a red post-push CI is fleet-wide breakage,
not a local-only failure. The push itself does not finish the change; the
agent must watch the triggered runs and drive them to green (fix-forward),
not declare victory at the push.

**Action:** prints a reminder that the push is not done until CI is green,
naming the watch commands (`gh run watch`, `gh run list --limit 5`), and
that the full pre-push gate (`pnpm run update`, `pnpm i`, `fix --all`,
`check --all`, `cover`, all tests green) should already have run. Does NOT
run the watch itself (`gh run watch` is a long-lived network operation —
too heavy to fire blind from a fast hook); the agent runs the named
commands.

**Command gate:** the `git push` check (via the shared `commandsFor` AST
parser, not a regex) keeps it quiet — a non-push Bash call, or a
`git push --dry-run`, never triggers the reminder.

**Bypass:** none — informational only (exit 0).
