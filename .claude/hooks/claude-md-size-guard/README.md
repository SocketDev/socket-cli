# claude-md-size-guard

PreToolUse Edit/Write hook that blocks CLAUDE.md edits which would push the **fleet-canonical block** (between `<!-- BEGIN FLEET-CANONICAL -->` / `<!-- END FLEET-CANONICAL -->` markers) above 40 KB.

## Why

The fleet block is byte-identical across every `socket-*` repo. Every byte added there costs N copies of in-context tokens fleet-wide. Per-repo content outside the markers is paid once. Capping the fleet block at 40 KB:

- Forces new fleet rules to be **terse + reference-deferred** (link to `docs/references/<topic>.md`).
- Leaves headroom for per-repo content. Per-repo CLAUDE.md additions are NOT capped here.
- Catches accidental size growth at edit time, before the bytes propagate via `sync-scaffolding`.

## How

The hook fires on Edit/Write tool calls. For Write, it inspects `content`. For Edit, it splices `old_string` → `new_string` against the on-disk file and measures the post-edit fleet block. If the block exceeds the cap, exits 2 with stderr explaining the overage and the canonical remediation (move details into `docs/references/<topic>.md`).

## Cap

- **Default:** 40 KB (40 960 bytes).
- **Override:** set `CLAUDE_MD_FLEET_BLOCK_BYTES=<n>` in env (rarely needed; bumping the cap should be a deliberate fleet-wide decision).

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a buggy hook can't brick the session. The trade-off: a bug means the cap silently doesn't apply for that edit. Acceptable because the alternative (hook crash blocks unrelated edits) is worse.

## How to add a fleet rule that fits

1. Write the rule as a single paragraph (3-5 lines max) in the fleet block.
2. Move the expanded explanation to `docs/references/<topic>.md` (cascaded fleet-wide via `SHARED_SKILL_FILES` in `sync-scaffolding/manifest.mts`).
3. Link from the rule body: `[Full details](docs/references/<topic>.md)`.

The `bypass-phrases` reference (`docs/references/bypass-phrases.md` ↔ the "Hook bypasses require the canonical phrase" CLAUDE.md rule) is the canonical shape.
