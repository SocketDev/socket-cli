# cascade-graph-defers-to-script-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2). Fleet-scoped convention.

**Rule:** the cascade obligations are code-is-law. The graph in
`scripts/fleet/lib/release-cascade.mts` is DATA, not the whole answer — some
fleet repos ship zero runtime deps and BUNDLE their upstreams into `dist/**`, so
an upstream bump owes a downstream RELEASE, not just a catalog pin. Eyeballing
the raw graph and reasoning ad-hoc misses that. This guard blocks a hand
inspection of the graph and steers the operator to the SMART scripts that
account for bundling, so an AI never squints at the map and concludes wrong.

## What it blocks

- `cat` / `head` / `tail` / `less` / `more` / `bat` / `view` of a
  `release-cascade.mts` file.
- `grep` / `rg` targeting `release-cascade.mts` or the `RELEASE_CASCADE_GRAPH`
  symbol anywhere.
- `git show <ref>:.../release-cascade.mts`, `git log -- .../release-cascade.mts`,
  `git grep RELEASE_CASCADE_GRAPH`, `git cat-file` of the graph file.

## What it allows

- `node scripts/fleet/socket-lib-cascade.mts --status` — the smart status
  script, which accounts for bundling.
- `node scripts/fleet/check/cascade-followups-are-settled.mts` — the settle
  check that stands on `computeOwedFollowUps` + `findUndeclaredBundledEdges`.
- editing the graph through the Edit/Write tools, running its code any other
  way, and every non-inspection command. Those match no rule.

**Pure decision:** `decideCascadeGraphGuard(command)` returns `{ blocked, reason }`.
It is exhaustively unit-tested without touching the filesystem. The wrapper adds
the CI passthrough, the fleet-membership scope stand-down, and the bypass phrase.

**Parsing:** each `cat` / `grep` / `rg` / `git` segment is AST-parsed via
`commandsFor`, robust to leading env assignments, `git -C <path>`, quoting, and
`&&` / `;` / `|` chains — so a quoted "release-cascade.mts" inside a message
never false-fires.

**Does NOT fire when:**

- the context is CI — `CI` / `GITHUB_ACTIONS` / `CONTINUOUS_INTEGRATION` set. CI
  runs the checks through its own workflow, not an interactive agent.
- the acted-on repo is not fleet-managed — `scope: 'convention'` stands the hook
  down in a foreign repo.

**Stable code:** `ERR_FLEET_CASCADE_GRAPH_DEFERS_TO_SCRIPT` in the block message.

**Bypass:** `Allow cascade-graph-inspect bypass` typed verbatim in a recent user
turn — for the genuine case of reading the graph file to edit it by hand.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not wedge
every Bash call.
