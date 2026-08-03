/**
 * @file Rolldown plugin: apply targeted, BEHAVIOR-PRESERVING lazy transforms to
 *   the handful of `@socketsecurity/lib` dist modules that capture a native
 *   `[Foreign]` handle at MODULE-EVAL, so the snapshot build
 *   (`--build-snapshot`) does not abort with `global handle not serialized:
 *   [Foreign]` → `CheckGlobalAndEternalHandles failed`. SPIKE
 *   (spike/snapshot-hooks) — the LOCAL-PROTOTYPE wiring of the upstream lib
 *   fix. WHY this exists. The full 190-hook snapshot bundle drags two lib
 *   modules that construct `new AsyncLocalStorage()` at module-eval —
 *   `env/rewire.js` (`isolatedOverridesStorage`) and `themes/context.js`
 *   (`themeStorage`). An `AsyncLocalStorage` registers a native async-hook
 *   `[Foreign]` handle V8 refuses to serialize into a startup snapshot. Both
 *   storages are read ONLY inside function bodies
 *   (`getEnvValue`/`withEnv`/`getTheme`/`withTheme`/…), so deferring their
 *   construction to first use is behavior-identical — and that is exactly what
 *   unblocks the env-rewire / theme-context graph for bundle A. HOW. Rather
 *   than mutate the read-only pnpm store or require a populated overlay dir
 *   (the prototype's earlier shape, which silently no-op'd because the overlay
 *   path symlinks back to the store), this plugin reads the store's REAL module
 *   source for the matched file and rewrites just the eager `const X = new
 *   AsyncLocalStorage()` binding into a lazily-initialized accessor — leaving
 *   every other line, export, and behavior untouched. Build-time only; the real
 *   path is the upstream lib release deferring these two constructions, plus a
 *   version bump, after which this plugin goes away. The SDK
 *   (`@socketsecurity/sdk`) inlines its OWN bundled copies of these two lib
 *   modules under `__commonJS` wrappers; those copies are only evaluated when
 *   the SDK calls `require_rewire()` / `require_context()`, which it does NOT
 *   at barrel module-eval — so they stay deferred without this plugin. This
 *   plugin only needs to cover the lib-stable ESM import path that a hook pulls
 *   directly. The lazy SDK client construction (`check-new-deps`) is handled in
 *   the hook itself.
 */

import { readFileSync } from 'node:fs'

import type { Plugin } from 'rolldown'

// The dist-relative paths whose module-eval `new AsyncLocalStorage()` is rewritten
// to lazy. Kept narrow to exactly the two confirmed serialize blockers for the
// full 190-hook bundle; the other eager-capture classes (spinner / semver /
// signal-exit / yocto / abortSignal) are handled by the snapshot config's stubs
// + build-pass shims (see hook-bundle-snapshot.config.mts) and do not need a
// source rewrite here.
const ASYNC_LOCAL_STORAGE_REL = ['env/rewire.js', 'themes/context.js'] as const

/**
 * Rewrite an `@socketsecurity/lib` dist module so its module-eval `const <name>
 * = new AsyncLocalStorage()` becomes a lazily-constructed accessor. Every read
 * site already goes through a function body, so swapping the eager binding for
 * a first-use getter is behavior-preserving. The transform is a targeted
 * textual edit, the store source is rolldown-emitted, stable shape: the `const
 * <name> = new AsyncLocalStorage()` line is replaced with a `__lazy_<name>`
 * holder + a getter, and every later `<name>.` member access is routed through
 * the getter.
 */
function deferAsyncLocalStorage(src: string): string {
  // Match `const <ident> = new AsyncLocalStorage();` (the two known holders are
  // `isolatedOverridesStorage` and `themeStorage`; match generically).
  const re = /const (?<ident>\w+) = new AsyncLocalStorage\(\);/g
  const names: string[] = []
  let out = src.replace(re, (_m, name: string) => {
    names.push(name)
    // Lazy holder + getter. `AsyncLocalStorage` is the destructured ctor already
    // in module scope; the getter is the only thing that calls `new`, deferring
    // the native-handle registration to first use, post-deserialize at runtime.
    return (
      `let __lazy_${name};\n` +
      `function __get_${name}() {\n` +
      `  return (__lazy_${name} ??= new AsyncLocalStorage());\n` +
      `}`
    )
  })
  // Route every later member access `<name>.foo` through the getter. The only
  // uses in these modules are `<name>.getStore()` and `<name>.run(...)`; a plain
  // `.`-access rewrite covers both. The binding line itself was already replaced
  // above (it no longer contains `<name>.`), so this only touches read sites.
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    out = out.replace(new RegExp(`\\b${name}\\.`, 'g'), `__get_${name}().`)
  }
  return out
}

/**
 * The lib snapshot-fix plugin: rewrites @socketsecurity/lib(-stable) imports
 * whose module state cannot survive V8 snapshot serialization.
 */
export function createLibSnapshotFixPlugin(): Plugin {
  // Match any resolved id under a @socketsecurity/lib(-stable) dist ending in one
  // of the AsyncLocalStorage-bearing relative paths — store, nested per-hook
  // node_modules, or overlay alike.
  const matchers = ASYNC_LOCAL_STORAGE_REL.map(rel => ({
    re: new RegExp(`@socketsecurity[/+]lib[^/]*[\\s\\S]*?/dist/${rel}$`),
  }))
  return {
    name: 'lib-snapshot-fix',
    load(id) {
      for (const { re } of matchers) {
        if (re.test(id)) {
          return {
            code: deferAsyncLocalStorage(readFileSync(id, 'utf8')),
            moduleSideEffects: true,
          }
        }
      }
      return undefined
    },
  }
}
