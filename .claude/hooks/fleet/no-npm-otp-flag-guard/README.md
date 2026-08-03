# no-npm-otp-flag-guard

PreToolUse Bash hook that blocks an npm-family auth command from passing the 2FA one-time code as a flag. npm-family auth uses BROWSER auth (`--auth-type=web`); the OTP is never a command-line argument.

## What it blocks

A Bash command that invokes `npm`, `pnpm`, or `yarn` **and** carries an `--otp` flag in either form:

| Pattern             | Bypass phrase             |
| ------------------- | ------------------------- |
| `--otp=<code>`      | `Allow npm-otp-flag bypass` |
| `--otp <code>`      | `Allow npm-otp-flag bypass` |

`--otp` is unambiguously an npm-family auth flag, so its presence on one of those binaries means an auth command (publish / login / access / dist-tag / unpublish / deprecate / owner) is leaking the one-time code.

## What it does NOT block

- Any command without `--otp` — `npm install`, `npm run build`, `npm ci`, `npm test`, bare `npm publish`.
- The correct browser flow: `npm publish --access public --auth-type=web` (npm opens the browser to approve 2FA).
- A literal `--otp` inside a quoted commit message or a sibling command that is not an npm-family invocation — the matcher parses the command with the fleet shell tokenizer (`commandsFor`), so the flag only counts when it rides an `npm`/`pnpm`/`yarn` segment's own args.

## Why

Passing the OTP on the command line writes the one-time code into:

- **shell history** (`~/.zsh_history`, `~/.bash_history`),
- **the process list** (`ps` shows full argv to any local user),
- **CI logs** — the command line is echoed.

A one-time code in any of those is a leaked secret (token-hygiene). The browser flow (`--auth-type=web`) never puts a code on the CLI, and CI authenticates with a granular automation token via the `NODE_AUTH_TOKEN` env var. The bullet in CLAUDE.md is also the doctrine that stops the assistant from *suggesting* `--otp` in prose.

## How the bypass works

The hook reads the conversation transcript (path passed in the PreToolUse JSON payload) and searches the user-turn text for the exact phrase `Allow npm-otp-flag bypass`. The match is **case-sensitive** and **substring-based** — a paraphrase does not count, and a phrase from a previous session does not carry over.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy can't brick the session.

## Companion files

- `index.mts` — the hook itself (exports the pure `otpFlagBinaryIn` / `otpFlagViolation` matchers the test drives)
- `package.json` — declares the hook as a workspace package
- `tsconfig.json` — fleet-canonical TS config for hooks
- the unit test lives in `test/repo/unit/hooks/no-npm-otp-flag-guard.test.mts` (co-located hook tests are banned; relocated to `test/repo/`)
