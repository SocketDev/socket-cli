# no-glob-run-s-guard

**Type:** PreToolUse guard (Edit/Write/MultiEdit) — BLOCKS (exit 2).

**Trigger:** an Edit/Write/MultiEdit to a `package.json` whose incoming content
contains a `run-s <prefix>:*` or `run-p <prefix>:*` glob suffix in any scripts
value.

**Why:** npm-run-all2 resolves `:*` globs via `Object.keys(scripts)`, which
follows ECMA-262 OrdinaryOwnPropertyKeys §10.1.11 — package.json source order,
not alphabetical. An order-dependent aggregator using a glob silently runs tasks
in the order they were written; inserting or reordering a script entry breaks it
without a test signal. CLAUDE.md "npm-run-all-ordering".

**Fix the message gives:**
- List tasks explicitly: `"gen": "run-s gen:logo gen:socket-icon gen:showcase"`
- Reference: `docs/agents.md/fleet/npm-run-all-ordering.md`

**Bypass:** `Allow run-s glob bypass` typed verbatim in a recent user turn (for
aggregators that are provably order-independent).

**Companion surfaces:**
- Lint rule `socket/no-glob-in-ordered-run-s` — catches the pattern in `.ts`/`.mts` source strings.
- Check script `scripts/fleet/check/run-s-globs-are-explicit.mts` — full-scan of all fleet `package.json` files.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not wedge
every Edit call.
