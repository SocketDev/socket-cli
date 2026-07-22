# socket/no-module-eval-side-effects

Forbid native-handle capture and I/O at module eval (top-level statements that
run the instant a module is imported).

## Why

Two payoffs, one rule:

1. **Startup.** A module that acquires a TTY stream, an SDK client, an
   AbortSignal, or reads a file the moment it loads pays that cost on every
   consumer's import — even consumers that never touch the handle. Lazy
   acquisition defers the cost to first real use.
2. **V8-snapshot safety.** The fleet hook dispatcher boots from a V8 startup
   snapshot. A native `[Foreign]` handle captured at module eval cannot be
   serialized into the blob — V8's serializer aborts with
   `global handle not serialized: [Foreign]` (a fatal native abort, not a
   catchable error), and `WebAssembly` is `undefined` in the `--build-snapshot`
   builder context entirely. A module-eval `new SocketSdk()` /
   `getDefaultSpinner()` / `new WebAssembly.Module()` silently excludes that
   module's whole graph from the snapshot. This rule keeps the snapshot-safety
   the fleet bought from rotting back — the exact class four agents just fixed
   (`getDefaultSpinner()` / `getAbortSignal()` / `new AsyncLocalStorage()` at
   module scope).

The rule has two halves: a **hygiene subset** that fires wherever the rule runs,
and two **snapshot-eligible-only clauses** that fire only in modules that freeze
into the V8 dispatch bundle.

## What it flags — hygiene subset (everywhere)

Module scope — a statement **not** inside any function or class-method body —
matching the denylist. These cost startup time and break the snapshot
everywhere, so they are flagged repo-wide:

- **`new` of a denylisted constructor:** `AsyncLocalStorage`, `SignalExit`,
  `SocketSdk`, `Comparator` (semver), `SharedArrayBuffer`.
- **WebAssembly:** `new WebAssembly.Module` / `.Instance` / `.Memory`, and
  `WebAssembly.compile` / `.instantiate` calls.
- **Native-handle factory calls:** `getDefaultSpinner`, `getAbortSignal`,
  `yoctoSpinner` (the yocto-spinner factory).
- **Module-scope I/O:** a synchronous `fs` read (`fs.*Sync(...)`),
  `process.stdin` / `.stdout` / `.stderr` access, and any `child_process`
  member call (`spawn` / `exec` / `fork` / …).

The detection is a **syntactic heuristic** — module scope plus a denylist match.
It catches the known blocker classes, not every conceivable handle. The
denylists live as clearly-commented `const` sets at the top of `index.mts`; a
new pattern is a one-line addition.

The seeded denylist is grounded in the empirically-found snapshot blockers
documented in
`template/base/.claude/hooks/fleet/_dispatch/SNAPSHOT-NOTES.md` — every entry
corresponds to a `[Foreign]`-handle / WASM / circular-init failure that actually
aborted `--build-snapshot`.

## What it flags — snapshot-eligible-only clauses

Two more clauses fire **only when the file being linted is part of the V8
dispatch bundle** (see "Snapshot-eligible scope" below). The syntax they flag is
perfectly fine in ordinary fleet code — most hooks legitimately end in
`await runHook(...)`, and scripts use dynamic import — so flagging it repo-wide
would be wrong. It is flagged only for the bundled subset, where it cannot
survive the synchronous, statically-frozen snapshot build:

- **Top-level `await`** (module-scope `await` / `for await`): the snapshot build
  pass is synchronous, so a module-scope `await` aborts `--build-snapshot`. Move
  the work into `run()` — the dispatcher awaits the hook. This reuses
  `socket/no-top-level-await`'s enclosing-function walk and bypass marker —
  that rule is OFF in the hooks tree (TLA there is the normal entrypoint
  pattern), so this clause re-bans it only for the snapshot-eligible subset.
- **Variable-path dynamic `import()`**: a non-literal specifier
  (`import(path.join(dir, rel))`) can't be statically resolved by the bundler
  and therefore can't be frozen into the snapshot — only a string-literal
  `import('node:fs')` is snapshottable. (This fires anywhere in the module, not
  just at module scope: the bundler resolves at build time, so lazy/eager is
  irrelevant.)

### Snapshot-eligible scope

"Snapshot-eligible" = the modules that freeze into the dispatch bundle (the
rolldown bundle's input closure), mirroring the maker
(`scripts/fleet/make-hook-dispatch.mts`):

- the `_dispatch/` and `_shared/` dispatch graph (always bundled), and
- each **bundle-safe** hook `index.mts` — one carrying the maker's two markers:
  the entrypoint guard `import.meta.url === \`file://${process.argv[1]}\`` **and**
  `export function run(`.

A hook that runs via top-level `await runHook(...)` lacks the `export run`
marker, so the maker never bundles it — it is **not** snapshot-eligible, and its
top-level await is **not** flagged. Eligibility is computed per file from the
absolute path plus (for a hook `index`) the file's own source, so it works both
in a real repo and in the RuleTester's tmp-dir fixtures.

A genuine runtime entrypoint that lives inside the dispatch graph dirs but is
**not** a bundle member — e.g. `_shared/dispatch.mts`, the live
runtime dynamic-dispatch script run via `settings.json` (the static
`_dispatch/` bundle supersedes it) — opts out with a per-line disable carrying
that reason.

## Fix

Acquire lazily, at first use — not at module scope:

```ts
// Bad — runs on every import.
const spinner = getDefaultSpinner()

// Good — memoized getter, deferred to first call.
let _spinner: Spinner | undefined
function spinner(): Spinner {
  return (_spinner ??= getDefaultSpinner())
}
```

Or push the default to the call site, the fleet's existing lazy pattern (e.g.
`spawn()`'s `const spinnerInstance = options.spinner ?? getDefaultSpinner()`).

## Not flagged

The same hygiene operation **inside a function or class-method body** is lazy
(runs on call, not on import) and passes. For the snapshot-eligible-only clauses,
the same syntax in a **non-eligible** module — an `await runHook(...)` entrypoint
hook, a `scripts/` runner, `src/` — is not flagged at all. A string-literal
dynamic `import('…')` always passes.

## Escape

A genuine module-eval construction uses a per-line disable with a reason:

```ts
// oxlint-disable-next-line socket/no-module-eval-side-effects -- entry-point launcher, never bundled into the snapshot
new SignalExit()
```

Line-scoped only — `socket/no-file-scope-oxlint-disable` forbids the file-scope
form.

## Severity

`error` (fleet-wide). Report-only — the lazy rewrite needs the surrounding
intent, so the human (or the AI-fix step) makes the call.
