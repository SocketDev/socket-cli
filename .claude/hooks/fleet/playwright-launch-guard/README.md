# playwright-launch-guard

PreToolUse (Edit/Write/MultiEdit) hook that blocks a hand-rolled Playwright browser launch at the moment it enters a `.mts`/`.ts`/`.mjs` file under `scripts/**` or `.claude/skills/**`.

## Why

A hand-rolled npm browser bootstrap burns the operator through repeated post-OTP sign-in loops while the proven module sits unused. Note: that covers a bare `chromium.launch(`, sandbox-disabling args, and retry loops through the Cloudflare challenge. The contract lives in one sanctioned module, `scripts/fleet/publish-infra/npm/browser-session.mts`: persistent context only, no sandbox flags, no scripted login, pause-not-retry on Cloudflare. This guard makes the sanctioned module the only path that compiles into the repo's automation surfaces.

## What it does

Denies the write when the about-to-land text (Write `content`, Edit `new_string`, each MultiEdit `new_string`) carries any of:

1. A quoted `--no-sandbox` launch arg, or the `chromiumSandbox` option — sandbox-disabling is never sanctioned.
2. A bare `chromium.launch(` — persistent context via the session module is the only sanctioned form.
3. A `launchPersistentContext(` call in a file that is not a sanctioned session owner. The allowlist is exact: a path ending `publish-infra/npm/browser-session.mts`; the `rendering-chromium-to-png` screenshot skill files; and a path ending `ghcr-package-visibility/browser.mts` (2026-07-29: pre-existing driver, migrates to the session module later).

The denial names the violation and the fix: import `openNpmBrowserSession` from `scripts/fleet/publish-infra/npm/browser-session.mts` and drive the returned session. Clean writes pass silently — there is no always-on reminder. Files outside `scripts/**` and `.claude/skills/**` (tests, docs, this hook itself) are out of scope.

## Bypass

`Allow playwright-launch bypass` — auto-wired via `defineHook` metadata, so the phrase the block message shows is provably the phrase the detector accepts, and the exception lands in the guard-event log.
