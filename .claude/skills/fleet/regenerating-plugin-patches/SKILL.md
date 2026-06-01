---
name: regenerating-plugin-patches
description: Regenerates plugin-cache patches in scripts/plugin-patches/ against the pinned upstream plugin source when they go stale after a plugin SHA bump. Use when install-claude-plugins.mts warns that a patch no longer applies, or after bumping a plugin's source.sha in marketplace.json.
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(curl:*), Bash(patch:*), Bash(diff:*), Bash(git:*), Bash(mkdir:*), Bash(rm:*), Bash(cat:*), Bash(ls:*), AskUserQuestion
model: claude-haiku-4-5
context: fork
---

# regenerating-plugin-patches

Regenerate the wheelhouse-owned plugin-cache patches in `scripts/plugin-patches/` so each one applies cleanly to the **currently pinned** upstream plugin source. This is the recovery flow when a plugin's `source.sha` bumps in `.claude-plugin/marketplace.json` and the line numbers shift under our patches.

Patches are reapplied over the plugin cache by `scripts/install-claude-plugins.mts` (`reapplyPluginPatches()` → `patch -p1`). The cache is regenerated from the pinned source on every install, so a stale patch warns and no-ops — it never wedges the reconcile, but the bug it fixed reappears until the patch is regenerated.

The authority on the patch format is [`docs/claude.md/fleet/plugin-cache-patches.md`](../../../docs/claude.md/fleet/plugin-cache-patches.md). The edit-time gate is `.claude/hooks/fleet/plugin-patch-format-guard/`.

## Phase 1 — validate

1. Read `.claude-plugin/marketplace.json`. For each plugin collect `source.url` (the GitHub repo), the pinned `source.sha`, and `source.path` (the in-repo subdir, if any). These map a plugin name to `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/<file>`.
2. List `scripts/plugin-patches/*.patch`. Each filename is `<plugin>-<version>-<slug>.patch`.
3. For each patch, find the failing ones:
   - Strip the `# @…` header — everything before the first `--- ` line — into a temp file.
   - Fetch a pristine copy of every file the diff touches from the pinned-SHA raw URL into a temp `a/` tree (path relative to the plugin root, matching the `a/…` prefix).
   - Dry-run: `patch -p1 --dry-run --forward` against that pristine tree.
   - A forward dry-run that FAILS while a `--reverse --dry-run` SUCCEEDS means the fix is already upstream — flag for deletion, not regeneration. A patch that applies neither way is **stale** and needs regenerating.

Surface any fetch / parse error and stop rather than guessing.

## Phase 2 — regenerate the stale patches

For each stale patch:

1. Fetch the pristine target file(s) from `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/<file>` into `/tmp/plugin-patch-rebuild/a/<file>`. Copy each to a parallel `/tmp/plugin-patch-rebuild/b/<file>`.
2. Read the stale patch to recover its **intent** (the `+`/`−` lines and which files they touch) and its `# @…` header verbatim.
3. Re-apply that intent to the `b/` copy with the **Edit tool** — exact-match editing forces byte-for-byte context against the new pristine source.
4. Generate the diff:
   ```bash
   diff -u /tmp/plugin-patch-rebuild/a/<file> /tmp/plugin-patch-rebuild/b/<file> \
     | sed -E 's@/tmp/plugin-patch-rebuild/a/@a/@; s@/tmp/plugin-patch-rebuild/b/@b/@' \
     | grep -v $'^[-+]\{3\}.*\t'   # strip timestamps from ---/+++ lines
   ```
5. Prepend the original `# @plugin:` / `# @plugin-version:` / `# @sha:` / `# @description:` header verbatim, bumping `# @sha:` (and `# @plugin-version:` + the filename, if the version changed) to the new pin.
6. Validate: `patch -p1 --dry-run` against the pristine `a/` tree must exit 0. Write the regenerated patch back to `scripts/plugin-patches/<name>.patch`.

## Phase 3 — report

Print three lists and stop. **Don't commit, don't push** — the user reviews the regenerated patches first.

- `regenerated`: patch basenames rewritten against the new pin.
- `unchanged`: patches that already applied.
- `deleted`/`upstreamed`: patches whose fix is now in the pinned source (flagged for `rm` + manifest-entry removal — the bug is fixed upstream).
- `unrecoverable`: patches the regen couldn't fix + the diagnostic.

## Smallest footprint — prefer a sidecar over inlining

When the fix is more than a few lines, move the logic into a standalone module and let the diff just `import` it + swap call sites. Ship the module in the patch's companion `<x>.files/` dir (tree mirrors the cache root); `reapplyPluginPatches()` copies it in before applying the diff. A thin diff re-anchors across version bumps; a fat inlined one breaks on the first nearby edit. When regenerating, keep the diff thin — don't re-inline a body that already lives in `.files/`. (Exception: targets that can't import a sibling we control, e.g. some `pnpm patch` cases — inline there.)

## Patch format

A `# @key: value` provenance header above a **plain `diff -u` body**. Filename `<plugin>-<version>-<slug>.patch` (dotted semver version); substantial logic lives in the companion `<x>.files/` sidecar, not the diff. Authority: [`docs/claude.md/fleet/plugin-cache-patches.md`](../../../docs/claude.md/fleet/plugin-cache-patches.md).

```
# @plugin: codex
# @plugin-version: 1.0.1
# @sha: 9cb4fe4099195b2587c402117a3efce6ab5aac78
# @upstream: https://github.com/openai/codex-plugin-cc
# @description: One-line summary of what the patch fixes
#
--- a/scripts/lib/fs.mjs
+++ b/scripts/lib/fs.mjs
@@ -32,9 +32,39 @@
 context
-old
+new
 context
```

Required header keys: `@plugin`, `@plugin-version`, `@sha`, `@description`. `@upstream` is recommended.

## Constraints

- **Use `diff -u`, never `git diff` / `git format-patch`.** Both inject git markers (`diff --git`, `index <hash>..<hash>`, `new file mode`) that `patch -p1` doesn't expect — and the `plugin-patch-format-guard` hook rejects them at edit time.
- **Strip timestamps** from the `---`/`+++` lines: `grep -v $'^[-+]\{3\}.*\t'`. `diff -u` adds them; `patch` chokes on them.
- **The apply tool is `patch -p1`** — the same tool `install-claude-plugins.mts` uses. The `-p1` strips the leading `a/` / `b/` segment, so paths are plugin-root-relative.
- **Don't commit or push.** The user reviews the regenerated patches before committing.
- **Fetch from the pinned SHA, never a branch.** `raw.githubusercontent.com/<owner>/<repo>/<sha>/…` — a branch URL drifts and would regenerate against the wrong source.
