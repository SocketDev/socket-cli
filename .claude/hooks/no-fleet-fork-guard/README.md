# no-fleet-fork-guard

PreToolUse Edit/Write hook that blocks edits to fleet-canonical files inside downstream fleet repos.

## What it enforces

The fleet rule "Never fork fleet-canonical files locally" (CLAUDE.md fleet block, full reference at [`docs/claude.md/no-local-fork-canonical.md`](../../../docs/claude.md/no-local-fork-canonical.md)).

Fleet-canonical surfaces (anything tracked by `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts`):

- `.config/oxlint-plugin/` — oxlint plugin index + rules
- `.git-hooks/` — commit-msg / pre-commit / pre-push hooks + helpers
- `.claude/hooks/` — PreToolUse / PostToolUse hooks
- `.claude/skills/_shared/` — shared skill helpers
- `docs/claude.md/` — CLAUDE.md offshoot references
- `.husky/` — Husky entry shims

When Claude tries to Edit/Write a file under one of these prefixes in a fleet member (any repo with `CLAUDE.md` containing the `BEGIN FLEET-CANONICAL` marker, except `socket-wheelhouse/template/`), the hook exits 2 with a stderr message that:

1. States the rule.
2. Names the canonical file path inside `socket-wheelhouse/template/...`.
3. Provides the exact `sync-scaffolding` command to cascade.
4. Documents the bypass phrase.

Edits inside `socket-wheelhouse/template/` are ALLOWED — that IS the canonical home.

## Bypass

Reverting / overriding the block requires the user to type **`Allow fleet-fork bypass`** verbatim in a recent user turn. The phrase is scoped to the current conversation; it does NOT carry across sessions. Per the broader bypass-phrase contract enforced by `no-revert-guard` and the fleet CLAUDE.md "Hook bypasses" rule.

## Why a hook + a rule + a memory

- The CLAUDE.md fleet block documents the policy (visible at every prompt).
- A user-memory entry keeps the assistant honest across sessions.
- This hook is the actual enforcement at edit time.

The hook catches the failure mode where Claude reaches for a "quick fix" in a downstream repo's canonical file (typically because the local copy has a known bug and the user is in a hurry to land something else). The block flips the workflow back to "fix-in-template, cascade out" where it belongs.

## Detection

For each Edit/Write/MultiEdit call:

1. Resolve `tool_input.file_path` to an absolute path.
2. Check if the path contains `/socket-wheelhouse/template/` — if yes, allow.
3. Walk up directories looking for a fleet repo root: `package.json` AND `CLAUDE.md` containing the `BEGIN FLEET-CANONICAL` marker.
4. If no fleet repo root is found (the file is outside any fleet repo), allow.
5. Compute the file path relative to the repo root.
6. If the relative path matches one of the canonical prefixes, check the bypass phrase.
7. No bypass → exit 2 with the explanation.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session. The CLAUDE.md rule + memory still document the policy as a backstop.

## Companion files

- `index.mts` — the hook itself.
- `test/index.test.mts` — node:test specs.
- `package.json` — workspace declaration so `taze` can see the hook's deps.
- `tsconfig.json` — fleet-canonical TS config.

## Adding a new canonical surface

When a new directory becomes fleet-canonical (cascades via sync-scaffolding):

1. Add it to `CANONICAL_PREFIXES` in `index.mts`.
2. Add it to the bullet list in this README.
3. Add it to the bullet list in `docs/claude.md/no-local-fork-canonical.md`.
4. Add the surface to the sync manifest.
