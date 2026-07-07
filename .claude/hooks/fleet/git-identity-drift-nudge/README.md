# git-identity-drift-nudge

**Type:** Stop reminder — nudges, never blocks.

**Trigger:** at turn-end, the effective git `user.email` for the project
dir (local over global, the value git would stamp on a commit) is a
non-verifiable placeholder: `*@example.com`, `agent-ci@…`, or an RFC-2606
reserved domain (`*.example`, `localhost`, `invalid`, `test`). Matched by
the shared `isPlaceholderEmail` in `_shared/git-identity.mts`.

**Why:** a commit authored with a placeholder email fails GitHub's
`required_signatures` even when the GPG/SSH signature is valid, because
the author email isn't tied to the signing key's GitHub account. The bad
value is usually planted OUTSIDE the tool channel (an agent-CI container
entrypoint writes it to the local `.git/config`), so the PreToolUse
`git-config-write-guard` never sees the write. That guard's SessionStart
probe auto-unsets it, but only at session start. If the identity gets set
mid-session, the push is the first time you'd find out, after the work is
committed. This reminder catches it at the Stop boundary, before the push
round-trip.

**Action:** prints a reminder with the fix. When a global identity exists,
the fix is to drop the local override (`git config --local --unset
user.email` / `user.name`) so the signed global identity wins. Otherwise
it points to setting a real identity with `--global`. It also reminds you
to re-author commits already made this turn before pushing. Does not run
any git command and does not block the stop.

**Distinct from [`git-config-write-guard`](../git-config-write-guard/):**
that guard BLOCKS git-config WRITES of identity keys (PreToolUse) and
auto-unsets a placeholder local identity at SessionStart. This reminder
covers the already-set EFFECTIVE identity at a different boundary (Stop),
catching a mid-session drift the SessionStart probe missed. Both key off
the same `_shared/git-identity.mts` patterns.

**Bypass:** none — informational only (exit 0).
