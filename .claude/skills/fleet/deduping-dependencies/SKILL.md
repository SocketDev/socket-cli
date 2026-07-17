---
name: deduping-dependencies
description: Reduce duplicate dependency installs with safe overrides, hardened drop-ins, patches, and consumer checks.
user-invocable: true
allowed-tools: Bash(node:*), Bash(git:*), Bash(grep:*), Bash(rg:*), Bash(ls:*), Bash(pnpm install:*), Bash(pnpm patch:*), Bash(pnpm patch-commit:*), Read, Edit, Write
model: claude-sonnet-4-6
context: fork
---

# deduping-dependencies

Duplicate majors of a package in the install tree are dead weight: more bytes, more attack surface, and (for bundled outputs) bigger bundles. This skill collapses them **safely** — the hard part isn't finding duplicates, it's knowing which collapse is safe. That judgment is the decision tree below.

Three levers, in order of preference:

1. **`@socketregistry/*` redirects** — Socket-published, audited, API-transparent drop-ins for ubiquitous shims. Soak-exempt (Socket scope). Promote to the **fleet-canonical** `overrides:` (in `scripts/repo/sync-scaffolding/manifest/catalog.mts` → `FLEET_CANONICAL_OVERRIDES`) when present un-redirected in **≥6 repos** and CJS-interop (won't break ESM consumers). Narrower ones stay repo-specific.
2. **Version collapses** — pin duplicated majors to one version via `overrides:`.
3. **Compatibility patches** — when a collapse-to-latest is blocked by an API break a bundler can't fix, `pnpm patch` the new version to restore the old surface, then force unscoped.

## The decision tree (per duplicated package)

Classify the break **between the lowest major present and the collapse target**, then act:

| break kind | safe move | why |
|---|---|---|
| none / same-major / data-only (e.g. `mime-db`, `color-name`, `semver` 7.x) | **collapse unscoped** to highest present | no consumer-visible change |
| **CJS↔ESM format flip only**, and the fleet **bundles** these deps (SEA / rolldown) | **force the ESM major, unscoped** | the bundler resolves CJS↔ESM interop at build time, so the runtime-`require` break can't happen — and ESM tree-shakes to smaller bundles. Forcing also collapses the CJS+ESM split. |
| **non-format API break** (callback→promise, removed method, changed signature) — bundling does **not** fix this | **patch-for-compat then force**, else **scope** | a bundler resolves module format, never an API contract. If a compat shim is feasible, `pnpm patch` the new version + force unscoped (max dedup). If not, scope the override (`'name@>=N': 'X'`) to leave the incompatible major alone. |

The trap: "we bundle, so just force the newest ESM" is **only** true for *format* flips. `isexe` 2→4 looks like an ESM bump but is really a callback→promise API break — forcing it breaks `which@2` regardless of bundling. Always classify format-vs-API before forcing.

**Node floor is not the risk.** The fleet runs Node 26+; any modern version's `engines.node` (18/20/22) is satisfied. Node-floor bumps are acceptable by default — they are never the reason to scope. The risks are only the two columns above.

## Mandatory verification before any force/collapse

Never assert safety — prove it:

1. **Module format + engines** — read the on-disk `package.json` (`type`, `exports`, `engines`) for *each* version present (`<repo>/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/package.json`). This decides format-flip vs not.
2. **Consumer-grep for the broken/removed API** — for a non-trivial major span, grep the fleet's installed trees for the specific removed/changed surface. If **no live consumer** hits it (or the only one is a self-contained bundled tool that declares no dep on the package), the collapse is API-safe.
   - Example (chalk → 5.6.2): `chalk.styles`/`hasColor`/`stripColor` (removed v2) had **0** fleet usage; the lone `chalk.constructor`/`Instance` user (`@anthropic-ai/claude-code`) bundles its own chalk and declares no chalk dep, so the override can't reach it → safe, **no patch needed**.
   - Example (isexe → 4): `which@2.0.2` calls `isexe(p, opts, cb)` (callback) and declares `isexe: ^2.0.0` → the force breaks it → **patch required**.
   - Example (which 2 → 7, **collapsed**): `cross-spawn@7` declares `which@^2.0.1` and calls `which.sync(cmd, {path, pathExt})`. which@7 is still CJS with a `.sync` reading the same `opt.path`/`pathExt`/`nothrow` surface, and the Node-floor bump is irrelevant → **unscoped the `which@>=4` override to `which`** (no format flip, no API break). Runtime-confirmed: cross-spawn.sync resolved a command via which@7.
   - Example (strip-ansi 6 → 7, **left as-is**): strip-ansi@7 is **ESM-only** (`type: module`); the only consumers are the **CJS** yargs@17 cluster (`cliui`/`string-width@4`/`wrap-ansi@7`, pulled by `@grpc/proto-loader`) which `require('strip-ansi')` at runtime — *not* bundled. Force-ESM would break the `require`, and no strip-ansi version is both >6 and CJS → **not collapsible** (format flip + non-bundled CJS consumer); leave the duplicate.
3. **Cross-repo gate (free safety net)** — the cascade runs `pnpm install --frozen-lockfile` per repo before committing. A force that breaks resolution fails that gate and the cascade commits *without* the bad lockfile, surfacing loudly. Re-run it after any override change; a clean frozen pass means the tree is consistent.

## Writing a compatibility patch (the isexe pattern)

When a force is blocked by an API break and a shim is feasible:

```bash
pnpm patch <pkg>@<version>          # opens an editable copy, prints its path
# edit the package's CJS/ESM entry to re-add the old surface (see below)
node -e '<load the patched entry; exercise the OLD API to prove it works>'
pnpm patch-commit <path>            # writes patches/<pkg>@<ver>.patch + a patchedDependencies entry
```

Worked example — `isexe@4.0.0` (restore the isexe@2 callable + callback signature). Appended to the CJS entry; makes `require('isexe')` callable and callback-aware while preserving isexe@4's promise behavior and named exports:

```js
// compat shim: callable export + (path, options, callback) signature
;(function(){var e=module.exports,i=e.isexe;function isexe(p,o,c){if(typeof o==="function"){c=o;o=void 0}if(typeof c==="function"){Promise.resolve(i(p,o||{})).then(function(r){c(null,r)},function(x){c(x)});return}return i(p,o)}Object.assign(isexe,e);isexe.default=isexe;module.exports=isexe})();
```

Patches are **fleet-canonical**: the `.patch` lives under `template/patches/` and `patchedDependencies` is cascaded with the override that forces the version — the two ship together (the patch is inert without the force, the force is unsafe without the patch).

## Where edits land

- **`@socketregistry` redirects + version overrides** → `FLEET_CANONICAL_OVERRIDES` in `scripts/repo/sync-scaffolding/manifest/catalog.mts`. `catalog:` overrides are valid **only** where the member's catalog carries that entry — bare names with no fleet-wide catalog entry (e.g. `rolldown`/`vite`/`magic-string`) must be a direct version pin or stay repo-specific, or pnpm trips `ERR_PNPM_CATALOG_IN_OVERRIDES`.
- **Compat patches** → `template/patches/<pkg>@<ver>.patch` + `patchedDependencies` (cascaded).
- After editing: from `socket-wheelhouse`, run `socket-wheelhouse/scripts/repo/sync-scaffolding/cli.mts --target . --fix` to dogfood-cascade, then the fleet wave. Validate the bundled-output repos with an actual build (bundling makes format safe; the build proves the API is too).

## Cadence & wiring

- **weekly-update** (`updating` skill / `weekly-update.yml`): re-run the dedup scan, promote newly-clearable `@socketregistry` drop-ins, collapse new same-major duplicates.
- **tidying / cleaning** (`tidying-*`): a dedup pass is part of shrinking the install + bundle.
- **code-as-law**: a `scripts/fleet/check/` invariant flags avoidable cross-major duplicates (a dup family that the decision tree says is collapsible but isn't pinned) so the fleet doesn't silently re-accumulate them.

## Scan recipe

```bash
# duplicate families (>1 major) + un-redirected @socketregistry drop-ins
node scripts/fleet/check/dependencies-are-deduped.mts
```

The scan is mechanical (parse `pnpm-lock.yaml` `packages:` keys → group by name → flag >1 major + cross-reference the `overrides:` drop-in set). The **judgment** (the decision tree + verification) is where care goes — fan out one analysis per package family for a large sweep, each grounding its verdict in the on-disk manifest + a consumer-grep.
