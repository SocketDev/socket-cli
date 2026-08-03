# denied-domain-reference-guard

PreToolUse Edit/Write hook that blocks landing a fleet-DENIED domain or a
denied filename IOC into any file. The denylist is the single source at
`_shared/denied-domains.mts`, shared with the commit-time
`scripts/fleet/check/denied-domains-are-absent.mts` check so the two surfaces
never drift.

## Why

An allowlist alone does not stop a lookalike. The 2026-07 fake-Corepack
campaign registered a domain that reads like the legitimate Node.js Corepack
tool's home and used it to distribute an infostealer + proxyware. A good-faith
engineer or agent seeing that hostname in a failing fetch could "fix" it into
a gh-aw `allowDomains` list, a firewall config, or a doc link. Every denylist
entry carries a dated reason and its advisory, and the block message prints
them verbatim — for the fake-Corepack entry that includes where the REAL
Corepack lives, so nobody "corrects" the entry.

## What it blocks

Any Edit/Write/MultiEdit whose about-to-land content carries a denied host
(boundary-aware, subdomains included) or a denied filename IOC. Egress
surfaces — `.github/workflows/**`, any `*.lock.yml`, and
`.config/fleet/egress-allowlist.json` — are blocked unconditionally.

## What it does NOT block

- Edits to the denylist surfaces themselves: `_shared/denied-domains.mts`,
  this guard, the commit-time check, and their basename-matched tests.
- A CHANGELOG — change-description prose, never loaded as active config.
- A markdown doc under `docs/` whose content carries the explicit
  IOC-citation marker comment, citing the IOC as an IOC:
  `<!-- fleet:denied-domains:ioc-citation -->`. Never valid on an egress
  surface.
- A per-entry `exemptPathRe` target, like the taze single-registry patch file
  that carries its vetoed endpoint in redirected-code context.

## Bypass

`Allow denied-domain bypass` typed verbatim in a recent user turn. Legitimate
uses are rare: advisory work belongs in a marked `docs/**.md` file, and there
is no legitimate reason to grant egress to a denied host.

## Detection

All data + matching live in `_shared/denied-domains.mts`. Fails open on any
hook error.
