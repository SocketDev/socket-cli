# cdn-allowlist-guard

PreToolUse(Bash) hook. **Blocks** a `curl` / `wget` / `fetch` to a host that
isn't on the fleet's public-CDN / package-registry allowlist.

## Why

Fetching from an arbitrary host mid-task is a supply-chain + exfiltration
surface. The fleet pins fetches to approved public package registries
(crates.io, pypi.org, npmjs.org, …) and public CDNs. The allowlist and its
matcher live in `_shared/cdn-allowlist.mts`, shared with the commit-time check
(`scripts/fleet/check/cdn-allowlist-is-respected.mts`) so the two never drift
(code is law, DRY).

## What it blocks

A Bash command that invokes a fetch tool (`curl` / `wget` / `fetch`) and
carries an `http(s)://` URL whose host is not in `ALLOWED_CDN_HOSTS` (exact) or
`ALLOWED_CDN_WILDCARDS` (`*.suffix`). A non-fetch command that merely mentions a
URL is not flagged.

## The allowlist holds PUBLIC hosts only

`ALLOWED_CDN_HOSTS` is seeded from the canonical public package registries every
ecosystem advertises. It is public knowledge, not a secret. **Never add an
internal host** (`*.svc.cluster.local`, a private staging URL): that is infra
topology and a public-surface-hygiene violation. A fetch to an internal host is
correctly blocked by this guard — route it through the proper service client,
don't allowlist it.

## Bypass

`Allow cdn-allowlist bypass` in a recent user turn, for a one-off legitimate
fetch. To permanently allow a new PUBLIC registry/CDN, add it to
`ALLOWED_CDN_HOSTS` / `ALLOWED_CDN_WILDCARDS` in `_shared/cdn-allowlist.mts`.
