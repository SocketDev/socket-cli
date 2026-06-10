# claude-md-size-guard

PreToolUse Edit/Write hook that blocks a CLAUDE.md edit which would push the **whole file** above the 40 KB cap (40 960 bytes). Fleet-canonical content and per-repo content both count toward the cap.

## Why

Every byte in CLAUDE.md is load-bearing in-context tokens for every Claude session opened in the repo, and the fleet-canonical block is duplicated across ~12 `socket-*` repos. The 40 KB ceiling forces ruthless reference-deferral:

- New fleet rules stay **terse + reference-deferred** — state the invariant + a one-line "Why" + a link to `docs/agents.md/fleet/<topic>.md` for the full pattern catalog.
- Accidental size growth is caught at edit time, before the bytes propagate via `sync-scaffolding`.

## How

Fires on Edit/Write/MultiEdit tool calls targeting a `CLAUDE.md`. For Write it measures `content`; for Edit it splices `old_string` → `new_string` against the on-disk file and measures the post-edit whole file. If the file exceeds the cap, exits 2 with stderr naming the size, the cap, the overage, and the canonical remediation.

## Cap

- **Default:** 40 KB (40 960 bytes), the whole file.
- **Override:** set `CLAUDE_MD_BYTES=<n>` in env (legacy `CLAUDE_MD_FLEET_BLOCK_BYTES` is read as a fallback). Rarely needed — bumping the cap should be a deliberate fleet-wide decision.

## Bypass

Type `Allow claude-md-size bypass` verbatim in a recent user turn to land one over-cap edit. One phrase authorizes one edit; the block message names the phrase. Prefer trimming detail into a `docs/agents.md/fleet/<topic>.md` page over carrying the file over-cap. Reference: `docs/agents.md/fleet/bypass-phrases.md`.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a buggy hook can't brick the session. The trade-off: a bug means the cap silently doesn't apply for that edit. Acceptable because the alternative (a hook crash blocking unrelated edits) is worse.

## How to add a fleet rule that fits

1. Write the rule as a single paragraph (3-5 lines max) in the fleet-canonical block.
2. Move the expanded explanation to `docs/agents.md/fleet/<topic>.md` (cascaded fleet-wide via `sync-scaffolding/manifest.mts`).
3. Link from the rule body: `[Full details](docs/agents.md/fleet/<topic>.md)`.
