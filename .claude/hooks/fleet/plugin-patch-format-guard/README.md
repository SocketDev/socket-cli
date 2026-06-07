# plugin-patch-format-guard

PreToolUse Edit/Write hook that blocks malformed plugin-cache patches under `scripts/fleet/plugin-patches/`.

## What it enforces

The runtime consumer is `scripts/install-claude-plugins.mts` — its `reapplyPluginPatches()` parses each patch filename, strips the `# @key:` header, and feeds the body to `patch -p1`. A patch that doesn't match the convention is skipped (or fails to apply) at reconcile time. This hook catches the mistake at edit time instead. Rules:

1. **Filename** matches `<plugin>-<version>-<slug>.patch` — lowercase-kebab plugin, dotted semver version, lowercase-kebab slug (e.g. `codex-1.0.1-stdin-eagain.patch`).
2. **Header** carries all four provenance keys as line-start comments: `# @plugin:`, `# @plugin-version:`, `# @sha:`, `# @description:` (`# @upstream:` is recommended but not required).
3. **Plain unified diff body** — must contain a `--- ` line, and must NOT contain git-diff markers: `diff --git`, `index <hash>..<hash>`, `new file mode`. `patch -p1` doesn't expect git markers; they break the apply.
4. **Version cross-check** — the `# @plugin-version:` value must match the version embedded in the filename (they map to the same plugin-cache dir).

## Scope

Fires only when the target `file_path` resolves under `scripts/fleet/plugin-patches/` and ends in `.patch` (normalized to `/`-separators first). Everything else passes through untouched.

`Write` carries the whole file in `tool_input.content`, so it's fully validated. `Edit` only carries a `new_string` fragment — the hook can't see the surrounding file, so an `Edit` without `content` is skipped (the next `Write` or commit-time path catches it).

## Why

A plugin-cache patch is replayed over a cache Claude Code regenerates on every install. The format is load-bearing: the filename maps to the cache dir, the header carries provenance, and the body must be a tool-`patch`-compatible plain diff. Git-diff output (`git diff` / `git format-patch`) injects `index`/`mode` markers that bare `patch` rejects — a classic foot-gun this gate closes. Full spec: [`docs/claude.md/fleet/plugin-cache-patches.md`](../../../docs/claude.md/fleet/plugin-cache-patches.md). Regenerate stale patches via the `regenerating-patches` skill.

## No bypass

This is a pure format gate, not a policy gate — there's no `Allow … bypass` phrase. A malformed patch is always wrong; fix the patch.

## Companion files

- `index.mts` — the hook (exports `classifyPluginPatch`, `isPluginPatchPath`, `emitBlock`).
- `test/index.test.mts` — node:test specs.
- `package.json` — workspace declaration so `taze` can see the hook's deps.
- `tsconfig.json` — fleet-canonical TS config.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session.
