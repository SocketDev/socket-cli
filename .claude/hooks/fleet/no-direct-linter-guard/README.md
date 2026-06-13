# no-direct-linter-guard

PreToolUse(Bash) hook that blocks invoking a linter or formatter binary
directly. The fleet runs lint/format only through the repo scripts (`pnpm run
lint` / `fix` / `check` / `format`) and the `scripts/fleet/*` wrappers — those
own the explicit `-c .config/fleet/<oxlintrc|oxfmtrc>` flag and the ignore set.

## What it catches

A Bash command whose resolved binary is one of `oxlint`, `oxfmt`, `eslint`,
`prettier`, `biome`, `dprint`, `rustfmt`, or `gofmt` (including the
`node_modules/.bin/<tool>` path form), or a `cargo fmt` / `cargo clippy`
subcommand. Detected by AST-parsing the command
(`shell-command.mts`/`findInvocation`), so it matches across pipes, `&&` chains,
and leading env vars and never false-matches a substring. `pnpm run …` and a
`node scripts/fleet/…` invocation pass; non-format `cargo` subcommands
(`cargo build`, `cargo test`) pass.

## Why

A bare formatter run is a double hazard. Configless `oxfmt`/`oxlint` falls back
to its own defaults (double-quote + semicolon) and corrupts fleet files; the
scripts always pass `-c .config/fleet/…`. A bare formatter also has no ignore
scoping and will reformat vendored `upstream/` trees the fleet must never touch
(the fleet `oxlintrc`/`oxfmtrc` ignore lists exclude `upstream/`,
`third_party/`, `vendor/`, `external/`). `eslint` / `prettier` / `biome` /
`dprint` are not fleet tools at all (see `no-other-linters-guard`); `cargo fmt`
/ `rustfmt` / `gofmt` reflow hand-formatted code. Reaching past the scripts
re-introduces every one of these. The committed-state companion is
`scripts/fleet/check/only-oxlint-oxfmt.mts`; the source-ref companion is
`socket/no-other-linters-guard`.

The scripts' own internal `node_modules/.bin/oxlint` spawns are child processes,
not Claude Bash invocations, so this hook never sees them — only a top-level
direct call is blocked.

## Bypass

Type `Allow direct-linter bypass` in a recent turn (for a genuine one-off).

## Exit codes

- `0` — pass (not Bash, a script wrapper, a non-format command, or bypassed)
- `2` — block
- Fails open on any internal error.
