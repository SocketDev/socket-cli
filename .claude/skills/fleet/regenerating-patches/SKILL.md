---
name: regenerating-patches
description: Regenerate plugin-cache patches against the pinned upstream plugin source after drift or SHA bumps.
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node:*), Bash(patch:*), Bash(diff:*), Bash(git:*), Bash(mkdir:*), Bash(rm:*), Bash(cat:*), Bash(ls:*), AskUserQuestion
model: claude-haiku-4-5
context: fork
---

# regenerating-patches

Regenerate the wheelhouse-owned plugin-cache patches in `scripts/fleet/plugin-patches/` so each one applies cleanly to the **currently pinned** upstream plugin source. This is the recovery flow when a plugin's `source.sha` bumps in `.claude-plugin/marketplace.json` and the line numbers shift under our patches.

Patches are reapplied over the plugin cache by `scripts/install-claude-plugins.mts` (`reapplyPluginPatches()` → `patch -p1`). The cache is regenerated from the pinned source on every install, so a stale patch warns and no-ops — it never wedges the reconcile, but the bug it fixed reappears until the patch is regenerated.

The authority on the patch format is [`docs/agents.md/fleet/plugin-cache-patches.md`](../../../docs/agents.md/fleet/plugin-cache-patches.md). The edit-time gate is `.claude/hooks/fleet/plugin-patch-format-guard/`. The pin-reading, fetch (`httpText`), classify (`patch --dry-run` forward + reverse), diff-rebuild (timestamp strip + path rewrite), header restamp, and final validate plumbing all live in [`lib/regen-patches.mts`](lib/regen-patches.mts). The skill keeps only the AI judgment — re-applying each stale patch's **intent** to the new pristine source with the Edit tool.

## Phase 1 — classify

```bash
# Print {current|upstreamed|stale} per patch, against the currently pinned SHA.
node .claude/skills/fleet/regenerating-patches/lib/regen-patches.mts classify
```

- `current` — applies cleanly; leave it.
- `upstreamed` — the fix is already in the pinned source (forward fails, reverse applies); flag for `rm` + manifest-entry removal, not regeneration.
- `stale` — applies neither way; regenerate it (Phase 2).

The script reads `.claude-plugin/marketplace.json` itself and fetches pristine sources via the lib `httpText` from the pinned-SHA raw URL. Surface any fetch / parse error and stop rather than guessing.

## Phase 2 — regenerate the stale patches

For each `stale` patch:

1. Stage the pristine target file(s) at the pinned SHA into a temp `a/` tree:
   ```bash
   node .claude/skills/fleet/regenerating-patches/lib/regen-patches.mts pristine <name>.patch
   # prints the staging dir; copy a/ → b/:
   cp -R <dir>/a <dir>/b
   ```
2. Read the stale patch to recover its **intent** — the `+`/`−` lines and which files they touch.
3. Re-apply that intent to the `b/<file>` copy with the **Edit tool** — exact-match editing forces byte-for-byte context against the new pristine source. (This step is yours; the script does the plumbing around it.)
4. Rebuild + restamp + validate in one call — emits the clean `diff -u` body (timestamps stripped, paths rewritten to `a/`-`b/`) under the restamped `# @` header, and fails non-zero unless `patch -p1 --dry-run` exits 0:
   ```bash
   node .claude/skills/fleet/regenerating-patches/lib/regen-patches.mts rebuild <name>.patch <dir> \
     > scripts/fleet/plugin-patches/<name>.patch
   ```
   If the version changed, rename the file and bump `# @plugin-version:` in the header after writing.

## Phase 3 — report

Print three lists and stop. **Don't commit, don't push** — the user reviews the regenerated patches first.

- `regenerated`: patch basenames rewritten against the new pin.
- `unchanged`: patches that already applied.
- `deleted`/`upstreamed`: patches whose fix is now in the pinned source (flagged for `rm` + manifest-entry removal — the bug is fixed upstream).
- `unrecoverable`: patches the regen couldn't fix + the diagnostic.

## Smallest footprint — prefer a sidecar over inlining

When the fix is more than a few lines, move the logic into a standalone module and let the diff just `import` it + swap call sites. Ship the module in the patch's companion `<x>.files/` dir (tree mirrors the cache root); `reapplyPluginPatches()` copies it in before applying the diff. A thin diff re-anchors across version bumps; a fat inlined one breaks on the first nearby edit. When regenerating, keep the diff thin — don't re-inline a body that already lives in `.files/`. (Exception: targets that can't import a sibling we control, e.g. some `pnpm patch` cases — inline there.)

## Patch format

A `# @key: value` provenance header above a **plain `diff -u` body**. Filename `<plugin>-<version>-<slug>.patch` (dotted semver version); substantial logic lives in the companion `<x>.files/` sidecar, not the diff. Authority: [`docs/agents.md/fleet/plugin-cache-patches.md`](../../../docs/agents.md/fleet/plugin-cache-patches.md).

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
