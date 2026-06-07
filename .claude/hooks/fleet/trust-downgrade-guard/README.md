# trust-downgrade-guard

PreToolUse hook. Blocks any action that **weakens a supply-chain trust gate**
unless the user typed `Allow trust-downgrade bypass` — and the bypass is
**single-use, never persisted**.

## What it blocks

**Bash commands** that relax a policy at invocation time:

- `--config.trustPolicy=trust-all` (or any non-`no-downgrade` value)
- `--config.minimumReleaseAge=0`
- `--no-verify-store-integrity`
- `--dangerously-allow-all-scripts` / `--dangerously-allow-all-builds`
- `--config.dangerously*=true`
- `ignore-scripts=false`

**Edit/Write** to a policy file (`pnpm-workspace.yaml`, `.npmrc`) that:

- sets `trustPolicy` to anything but `no-downgrade`
- lowers `minimumReleaseAge` below the fleet floor (10080)
- rewrites `pnpm-workspace.yaml` without `trustPolicy: no-downgrade` or
  `blockExoticSubdeps: true`

## Single-use bypass

`Allow trust-downgrade bypass` authorizes exactly **one** downgrade. The guard
counts prior downgrade actions in the assistant tool-use history (mirrors
`release-workflow-guard`'s per-dispatch model) and requires an unconsumed phrase
occurrence. A persisted bypass — an env var, or a phrase that opens the door for
every future downgrade — is _itself_ a trust downgrade, so it's disallowed by
design. Each downgrade needs its own freshly-typed phrase.

## The right fix instead of a downgrade

A stale lockfile rejected by `no-downgrade` (e.g. after bumping a dep whose old
version lost provenance) is fixed by **adding the soak / exclude entry for the
specific version and re-resolving** — never by disabling the policy.

## Why

An agent that runs `pnpm install --config.trustPolicy=trust-all` to force a
lockfile refresh past a stale-entry rejection disables package-takeover
protection to make a command succeed. CLAUDE.md "Never weaken a supply-chain
trust gate" states the rule; this hook enforces it.

## Related

- `minimum-release-age-guard` / `soak-exclude-date-guard` — the soak side.
- `check-new-deps` — Socket-scores new deps at edit time.
- `release-workflow-guard` — the single-use-bypass pattern this mirrors.
- CLAUDE.md → "Never weaken a supply-chain trust gate".
