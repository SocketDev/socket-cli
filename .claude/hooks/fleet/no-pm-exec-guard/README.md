# no-pm-exec-guard

PreToolUse(Bash) hook that blocks two banned run forms: `pnpm exec` / `npm exec`
/ `yarn exec`, and the fetch+execute forms `npx` / `pnpm dlx` / `yarn dlx`.

## What it catches

A Bash command that invokes `<pm> exec <tool>` (`pm ∈ {pnpm, npm, yarn}`) or a
fetch+execute form (`npx`, `pnx`, `pnpm dlx`, `yarn dlx`), detected by
AST-parsing the command (`shell-command.mts/findInvocation`), so it matches
across pipes / `&&` chains / leading env vars and never false-matches a
substring.

## Why

**`<pm> exec`** runs an already-installed `node_modules/.bin` binary but wraps it
in the package manager's startup + (in this fleet) the Socket Firewall
interception layer on every call — pure overhead. During the 2026-06-03 slowdown
investigation, bare `node_modules/.bin/tsgo` ran in 422ms vs the multi-second
`pnpm exec tsgo`. Run the bin directly (`node_modules/.bin/<tool>`) or via
`pnpm run <script>`.

**`npx` / `dlx`** FETCH + execute unpinned code — a supply-chain risk. The
`socket/no-npx-dlx` oxlint rule already bans these in committed source, but a
Claude Bash invocation runs before any lint, so this hook is the run-time block.
Add the dep and run it installed, or use `pipx` / `node_modules/.bin`.

## Bypass

Type `Allow pm-exec bypass` in a recent turn.

## Exit codes

- `0` — pass (not Bash, no `<pm> exec`, or bypassed)
- `2` — block
- Fails open on any internal error.
