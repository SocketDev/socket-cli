# bundle-stale-reminder

PostToolUse reminder that fires when you edit a hook-bundle source without rebuilding the bundle.

## Why

Import-safe fleet hooks are rolldown-bundled into `.claude/hooks/fleet/_dist/fleet-pack.cjs` and loaded through a V8 compile-cache loader for faster warm dispatch. Editing a bundled source leaves the built `fleet-pack.cjs` stale until you rebuild. Note: a bundled source is the dispatcher, the generated `dispatch-table.mts`, a bundled hook's `index.mts`, or anything under `_shared/`. This hook closes that loop the same way `extension-build-current-reminder` does for the trusted-publisher extension.

## What it does

After any `Edit` or `Write`:

1. Decide whether the edited path is a hook-bundle source.
2. Compare the source's mtime against `_dist/fleet-pack.cjs` — a missing bundle counts as stale.
3. If stale, return a `notify` verdict — the reminder lands on stderr. It never blocks (PostToolUse can't reject the prior call); it always exits 0.

Rebuild with:

```sh
node scripts/fleet/build-hook-bundle.mts
```

## Bypass

Type `Allow hook-bundle-current bypass` to silence the reminder when the rebuild is genuinely deferred. The slug is declared as `bypass` metadata on the hook's `defineHook` spec, so the framework wires phrase detection and appends the uniform footer naming the exact phrase — the message never hand-writes it.

## Test

```sh
pnpm test
```
