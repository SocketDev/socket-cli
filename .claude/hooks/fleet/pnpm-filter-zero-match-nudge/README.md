# pnpm-filter-zero-match-nudge

**Type:** PostToolUse reminder (Bash) — nudges, never blocks.

**Trigger:** a Bash command containing `--filter`, AND the tool output contains
"No projects matched the filters".

**Why:** `pnpm --filter <name> run x` exits 0 with "No projects matched the
filters" when no workspace packages match the filter name. This silent no-op has
false-greened builds twice: a typo in the package name produces an exit-0 run
that looks successful but ran no scripts at all.

**Action:** prints a nudge naming the failure and suggesting
`pnpm ls --filter <name> --depth -1` to verify the package name. Does NOT
block — the Bash tool has already completed.

**Bypass:** none — informational only (exit 0).
