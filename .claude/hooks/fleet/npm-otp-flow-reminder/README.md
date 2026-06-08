# npm-otp-flow-reminder

PreToolUse(Bash) reminder. Nudges (never blocks) when a Bash command runs an
npm registry operation that triggers npm's 2FA one-time-password challenge,
explaining that npm's preferred auth flow opens a browser and needs a real TTY.

## Trigger

A Bash command containing an `npm` invocation whose subcommand is one of the
account/registry-mutating, OTP-gated set:

- `npm deprecate`
- `npm publish`
- `npm access`
- `npm owner`
- `npm unpublish`
- `npm dist-tag`

Parsed via the shared `commandsFor` AST helper (sees through chains / quotes /
`$(…)`), per the no-command-regex-in-hooks rule.

## Why

npm's preferred OTP flow opens a browser and waits on an interactive TTY prompt
("Authenticate your account at: <url>"). The `!`-prefixed Bash channel — and any
headless driver — is not a TTY, so that prompt is swallowed and the command dies
with `npm error code EOTP` without ever opening the browser.

**Why:** an OTP-gated `npm` op run through the `!` channel loops on `EOTP` —
the interactive "open a browser" step never fires without a TTY. The reminder
steers the user to run it in a real terminal (preferred, browser auth) and
offers `--otp=<code>` only as the no-TTY fallback.

## Action

Stderr reminder, exit 0 (nudge, not block). Skipped when:

- `--otp` / `--otp=<code>` is already in the command (caller chose the fallback).
- The npm subcommand is not in the OTP-gated set (e.g. `npm install`, `npm view`).
- The command has no `npm` invocation.

## Bypass

No bypass — it's a reminder (exit 0), not a block. Adding `--otp=<code>`
to the command (the no-TTY fallback) already suppresses the nudge.
