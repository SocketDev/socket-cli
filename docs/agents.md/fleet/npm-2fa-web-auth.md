# npm 2FA web-auth from an agent shell

npm's account-mutating operations - `publish`, `login`, `deprecate`, `owner`,
`access`, `unpublish` - require 2FA. On a real terminal npm runs a browser
web-auth flow: it prints

```text
Authenticate your account at:
https://www.npmjs.com/auth/cli/<id>
Press ENTER to open in the browser...
```

opens the browser, and polls the registry until the human approves.

## Why it breaks under an agent

1. **No TTY.** The agent Bash channel is not a terminal. npm decides it cannot
   run an interactive/web flow and errors `EOTP` instead of opening the browser
   and staying alive to poll.
2. **Masked URL.** The agent harness redacts the auth URL in displayed tool
   output as `auth/cli/***`. The URL can never be relayed by reading what the
   terminal shows.

## The fix: `scripts/fleet/npm-web-auth.mts`

Run npm through the fleet PTY wrapper:

```bash
node scripts/fleet/npm-web-auth.mts <publish|login|deprecate|owner|access|...> [args...]
```

The wrapper:

- Runs npm under a pseudo-terminal - `script -q /dev/null npm ...` on macOS/BSD,
  `script -q -c '<cmd>' /dev/null` on Linux - so npm believes it has a TTY and
  performs its native open-and-poll web flow, staying alive until the human
  authenticates.
- Streams npm's output straight through to the caller AND watches the **raw**
  process stream for the auth URL. Reading the URL off the raw stream sidesteps
  the harness masking entirely: the URL flows only into the platform opener
  (`open` / `xdg-open` / `start`) as an argument and is never printed by the
  wrapper.
- Propagates npm's exit code.

It is a **no-op passthrough** when a real TTY is present (npm handles its own
flow) or when `--otp=<code>` is already supplied (no browser needed): it execs
npm directly. It is a zero-dependency fleet script: the `script` PTY needs no
added runtime dependency.

## Driving the approval page with browser automation

When the approval page is completed by automation (Playwright / the
chrome-devtools MCP) instead of a human click, ALWAYS check the session-trust
checkbox before clicking Authenticate:

> Do not challenge npm publish, npm trust operations from IP address
> `<current IP>` for the next 5 minutes

Match it by the **label prefix** (`Do not challenge npm publish`) - the label
embeds the machine's current IP, so a selector keyed on the full text (or a
hard-coded IP) breaks on the next network change and would bake a private
address into committed automation. Checking it suppresses repeat 2FA
challenges for 5 minutes, which is what lets a batch operation (a multi-name
placeholder run, an `owner`/`access` sweep) finish on one approval instead of
one browser round-trip per name.

## The guard: `npm-2fa-needs-pty-guard`

A PreToolUse Bash guard blocks a bare `npm publish|login|deprecate|owner|access`
from a non-TTY, non-CI agent shell and points at the wrapper, so the `EOTP` loop
is caught before it happens. It stands down on `--otp=`, on the wrapper
invocation itself, in CI, and in non-fleet repos. Bypass: `Allow npm-2fa-pty
bypass`.

## Fleet releases: staged web-UI, not local publish

For a scoped `@socketsecurity/*` package do **not** publish locally at all. Fleet
releases go through the STAGED web-UI flow: stage via the publish pipeline, then
promote the staged version in the npmjs.com web UI. The PTY wrapper is for the
interactive-auth mechanic of `login`/`deprecate`/`owner`/`access` and for
non-fleet or placeholder publishes - not for shipping a fleet package.
