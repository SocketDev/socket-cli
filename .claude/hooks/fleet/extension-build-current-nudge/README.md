# extension-build-current-nudge

PostToolUse hook that auto-rebuilds the trusted-publisher extension whenever a file under `tools/trusted-publisher-extension/src/` is edited.

## Why

The extension is loaded unpacked from disk during local development. Without this hook, an operator edits `src/popup.mts`, forgets to run `pnpm build`, hits Chrome's reload button — and sees stale behavior. The hook closes that loop automatically: every src/ edit triggers a fresh build so `dist/` is always current.

`dist/` is gitignored — we keep build artifacts off git, but the hook ensures they exist locally.

## What it does

After any `Edit` or `Write` to a path under `tools/trusted-publisher-extension/src/`:

1. Locate the wheelhouse repo root from cwd
2. Run `pnpm --filter @socketsecurity/trusted-publisher-extension build`
3. Print build failures to stderr (but always exit 0 — PostToolUse can't reject the prior call)

Build time is ~15ms with rolldown; no perceptible delay.

## Failure mode

If the build fails, you'll see the error tail in stderr. The hook still exits 0 (PostToolUse hooks can't reject what already happened). Fix the build error, then re-run:

```sh
pnpm --filter @socketsecurity/trusted-publisher-extension build
```

## Test

```sh
pnpm test
```
