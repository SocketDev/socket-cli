# no-ignoring-tracked-file-guard

PreToolUse (Write/Edit/MultiEdit) guard. Blocks a `.gitignore` edit in a fleet
repo that ADDS an ignore rule matching a file git ALREADY tracks — the
write-time twin of the commit-/CI-time check
`scripts/fleet/check/ignored-files-are-untracked.mts`.

A tracked-then-ignored file is a bug: the index and `.gitignore` disagree, and a
fresh clone re-ignores it (how build output / a vendored tree / a stray gitlink
leaked into the cascade in the first place).

- **Blocked:** a newly-added pattern that `git ls-files -- <pathspec>` shows
  matches a tracked file.
- **Allowed:** a `!` re-include (it UN-ignores), a pattern that matches nothing
  tracked, and a pre-existing entry — the commit-time check owns that backlog.
- **Match:** best-effort git pathspec (crosses `/`), not full gitignore
  semantics — the committed-tree check is the authoritative backstop.
- **Bypass:** `Allow ignoring-tracked-file bypass` (typed verbatim in a recent
  turn).

Fix: untrack the file FIRST (`git update-index --force-remove <path>` or
`git rm --cached <path>`), THEN add the rule; or keep it tracked (drop the rule,
or add a `!` re-include). Registry: `docs/agents.md/fleet/hook-registry.md`.
