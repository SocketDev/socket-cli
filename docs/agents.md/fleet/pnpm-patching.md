# pnpm patching to enable more deduping

Forcing a duplicated package to its newest (ESM) major maximizes dedup and bundle quality: one copy, tree-shakeable. But a **non-format API break** across the collapse range blocks the force. A bundler resolves CJS↔ESM module format; it never repairs an API contract (a removed method, a changed signature, callback→promise). When that is the only thing between you and a single forced version, a **pnpm patch** restores the old surface onto the new version so the force is safe. Patch-for-compat turns a `do-not-collapse` or `scoped` verdict into a clean unscoped collapse.

Keep the two concerns separate. The **override** (or the update) handles the dependency *requirement* — it collapses the tree to one version. The **patch** handles the *API contract* that the major change broke. The patch is not about the version; it is about the contract. A contract patch is equally valid whether the version arrived via an override-force, a security bump, or natural resolution.

This is the third dedup lever (after `@socketregistry` redirects and plain version overrides) in the [`deduping-dependencies`](../../../.claude/skills/fleet/deduping-dependencies/SKILL.md) skill.

## When to patch vs. scope

| situation | move |
| --- | --- |
| break is CJS↔ESM module format only, output is bundled | force the ESM major (no patch; the bundler handles interop) |
| API break, a small compat shim restores the old surface | patch, then force unscoped (max dedup) |
| API break, shim would be large or fragile, or the old major is rare | scope the override (`'name@>=N': 'X'`), leave the incompatible major |
| API break, but no live consumer uses the broken surface | force (no patch; verified by consumer-grep) |

A shim is feasible when the old surface maps onto the new one in a few lines: re-export a moved symbol, alias a renamed constructor, wrap a promise as a callback. It is not feasible when the semantics genuinely changed (different return shapes, removed behavior). Scope in that case.

## Mechanics

```bash
pnpm patch <pkg>@<version>            # opens an editable copy, prints its path
# edit the CJS and/or ESM entry to re-add the old surface
node -e '<load the patched entry; exercise the OLD API; assert it works>'
pnpm patch-commit <path>              # writes the .patch + a patchedDependencies entry
```

Patches are **fleet-canonical**, so they cascade with the override that needs them:

- the `.patch` file lives under `template/patches/<pkg>@<ver>.patch`;
- `patchedDependencies` in `pnpm-workspace.yaml` references it;
- the version is force-pinned in `FLEET_CANONICAL_OVERRIDES`.

The patch is inert without the force, and the force is unsafe without the patch. They ship as a pair. Patches are version-pinned: a version bump invalidates the patch, so re-author it against the new version before bumping the force.

## Code is law: the justified-patches invariant

A pnpm patch is opaque (a diff against minified vendor code) and high-trust (it rewrites a dependency). So every `patchedDependencies` entry must be **justified**, enforced by `scripts/fleet/check/dedup-patches-are-justified.mts`:

1. **Rationale annotation**: a `# dedup: <why>` comment on or above the entry, naming the API break it shims and the consumer that needs it (generic, no dated log per the dated-citation rule). An undocumented patch reads as a backdoor.
2. **Patch file exists** at the referenced path.
3. **Applicable**: the patched `<pkg>@<ver>` is actually resolved in `pnpm-lock.yaml`. A patch targets a contract on a *real* version; a patch for a version nothing resolves to is dead weight. This is deliberately **not** "has a corresponding force" — the patch fixes the contract, the version requirement is the override's job. They are orthogonal.

The check fails the build on any unannotated, dangling, or inapplicable patch. It reads `pnpm-workspace.yaml` + `pnpm-lock.yaml` (both per-repo), so it cascades and runs identically in every fleet repo.

## Worked examples

**`isexe@4`: callable + callback shim (force-enabling).** isexe@4's CJS export is `{isexe, sync}` (not callable) and dropped the `(path, options, callback)` signature. `which@2` calls `isexe(p, opts, cb)` and declares `isexe: ^2.0.0`. Bundling cannot fix either break. The shim, appended to the CJS entry, makes the export callable and callback-aware while preserving isexe@4's promise behavior:

```js
// compat: callable export + (path, options, callback), promise form preserved
;(function(){var e=module.exports,i=e.isexe;function isexe(p,o,c){if(typeof o==="function"){c=o;o=void 0}if(typeof c==="function"){Promise.resolve(i(p,o||{})).then(function(r){c(null,r)},function(x){c(x)});return}return i(p,o)}Object.assign(isexe,e);isexe.default=isexe;module.exports=isexe})();
```

Verified: `isexe(node, {}, cb)` calls `cb(null, true)`; `isexe(missing, {}, cb)` calls `cb(ENOENT)`; `isexe.sync(node)` returns `true`; `isexe(node).then(...)` resolves `true`. With the patch, `which@2` survives a force to isexe@4, collapsing isexe 2/3/4 to one copy.

**`chalk@5`: defensive only, and skipped.** chalk removed `styles`/`hasColor`/`stripColor` (v2) and `constructor` (v3). A consumer-grep found **zero** fleet usage of the removed methods, and the only `chalk.constructor` user (`@anthropic-ai/claude-code`) bundles its own chalk and declares no chalk dependency, so the force cannot reach it. **No patch was needed.** If a future consumer needed the v3 surface, the minimal shim is `chalk.Instance = Chalk` (alias the exported class).

Both examples teach the same rule: **verify before patching.** isexe genuinely needed the shim; chalk did not. A patch you do not need is trust surface you did not have to add.
