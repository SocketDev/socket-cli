# Plugin-cache patches

Third-party Claude Code plugins (pinned in `.claude-plugin/marketplace.json`)
occasionally ship bugs we've fixed but can't land upstream synchronously. The
plugin install lives in a **cache** at
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` that Claude Code
**regenerates from the pinned source on every (re)install** — so a hand-edit to
the cache is lost the next time `pnpm run install-claude-plugins` runs.

The durable fix: keep the change as a checked-in patch in
`scripts/fleet/plugin-patches/`, and have `install-claude-plugins.mts` reapply it over
the freshly-installed cache as a post-reconcile pass (`reapplyPluginPatches()`).

## Smallest patch footprint (prefer a sidecar over inlining)

<!-- enforcement: human-review — "smallest patch footprint" is a judgment heuristic about patch design, not a mechanically detectable violation; the sidecar-vs-inline call is made in review of the patch file -->
🚨 Keep the diff itself as small as possible. When a fix needs more than a few
lines of new logic, **move that logic into a standalone file** and let the diff
`import` it + swap the call sites, rather than inlining a 30-line function
body as `+` lines. A thin diff (an import + a call-site swap) re-anchors cleanly
across upstream version bumps; a fat inlined diff breaks on the first nearby
edit and is painful to review.

Mechanism: a patch named `<x>.patch` may ship a companion **`<x>.files/`**
directory whose tree mirrors the plugin cache root. `reapplyPluginPatches()`
copies it into the cache (overwrite) _before_ applying the diff, so the thin
diff's `import` of a sidecar module resolves. Example — the codex stdin fix
ships `codex-1.0.1-stdin-eagain.files/scripts/lib/read-stdin-sync.mjs` (the
30-line `readStdinSync` body) and the `.patch` is a 6-line diff that imports it
in three files.

This is doable for node-smol-shaped patches (we own the consuming source) and
for plugin-cache patches (we copy the sidecar in). It does NOT apply where the
patch target can't import a sibling we control (e.g. some `pnpm patch`
scenarios that rewrite a published package's internals) — there, inline.

## Patch format (socket-btm node-smol convention)

A `# @key: value` provenance header above a **plain `diff -u` body** — never a
`git diff` (git injects `index <hash>` / `new file mode` markers that bare
`patch` doesn't expect). The reapply step strips everything before the first
`---` line and pipes the diff to `patch -p1`. Sidecar modules (the
smallest-footprint mechanism above) live in the companion `<x>.files/` dir, not
in the diff.

```
# @plugin: codex
# @plugin-version: 1.0.1
# @sha: 9cb4fe4099195b2587c402117a3efce6ab5aac78
# @upstream: https://github.com/openai/codex-plugin-cc
# @description: One-line summary of what the patch fixes
#
# Optional multi-line detail. Each non-blank line begins with #.
#
--- a/scripts/lib/fs.mjs
+++ b/scripts/lib/fs.mjs
@@ -32,9 +32,39 @@
 context
-old
+new
 context
```

Required header keys: `@plugin`, `@plugin-version`, `@sha`, `@description`.
`@upstream` is recommended. Paths in the diff are plugin-root-relative
(`a/scripts/…`, `b/scripts/…`) so `patch -p1` resolves them inside the cache
dir. No timestamps on the `---`/`+++` lines (`diff -u` adds them; strip with
`grep -v $'^[-+]\\{3\\}.*\\t'`).

## Filename

`<plugin>-<version>-<slug>.patch` — e.g. `codex-1.0.1-stdin-eagain.patch`. The
`<plugin>` + `<version>` prefix maps to the cache dir; the version is dotted
semver (`1.0.1`), the slug is freeform lowercase-kebab. `parsePatchFileName`
(in `install-claude-plugins.mts`) parses it; a name that doesn't match is
skipped with a warning.

## Apply semantics

`reapplyPluginPatches()` runs after the plugin reconcile:

1. Parse the filename → `{ plugin, version }`; resolve the cache dir (skip if
   the plugin isn't installed on this machine).
2. Strip the `#` header; feed the diff to `patch -p1 --forward --silent` via
   stdin.
3. **Idempotency:** a forward `--dry-run` that fails while a reverse `--dry-run`
   succeeds means the fix is already present → skip. A patch that applies
   neither way (the plugin bumped, the patch went stale) **warns, doesn't
   abort** — a stale patch must not wedge the whole reconcile.

## Lifecycle

- **Upstream fixes the bug** → bump the SHA pin in `marketplace.json` (+ the
  README row) and **delete** the patch + its `manifest.mts` entry. The reapply
  step no-ops cleanly when no patch matches an installed plugin.
- **Upstream drifts but the bug persists** → regenerate the patch against the
  new pinned source via the `regenerating-patches` skill, rename to the
  new version, update the manifest entry.

## Why a separate dir (not `.claude-plugin/`, not `/patches/`)

- `.claude-plugin/` is Claude Code's convention dir (it reads `marketplace.json`
  / `plugin.json` from there). Putting our own files inside it risks a future
  strict validator and conflates ownership.
- `<root>/patches/` is pnpm's convention for `pnpm patch` npm-dependency
  patches (wired via `pnpm-workspace.yaml` `patchedDependencies`). A
  plugin-cache patch there would imply pnpm owns it.

`scripts/fleet/plugin-patches/` is plainly ours, next to its only consumer
(`install-claude-plugins.mts`).
