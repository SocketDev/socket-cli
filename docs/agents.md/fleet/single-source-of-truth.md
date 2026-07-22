# Single source of truth

Fleet-wide data — the repo roster, model pricing, tool pins, scope lists — lives in
exactly one authoritative file. Every consumer derives from it. A second copy,
even one that currently matches, is a DRY violation: copies drift, and the drift
ships before anyone notices.

## The rule

- **One source, many readers.** Pick one canonical file (JSON for data, a `.mts`
  constants module for typed values) and have every consumer read or import it.
  Do not hand-maintain a parallel array, list, or table of the same values.

- **Derive, don't copy.** A surrounding script (not bundled) reads the source at
  runtime: `readFileSync` + `JSON.parse`, or a static `import x with {type:'json'}`.
  A bundled consumer gets the value inlined by the bundler at build time. That
  inlined copy is a build artifact, not a hand-maintained source, so it is not
  duplication, and bundle code never reads the file at runtime.

- **The DRY violation is hand-maintained copies, not the bundler.** "Three lists
  that happen to match" is the bug. "One JSON the bundler bakes into `bundle.cjs`"
  is correct and preferred. Inlining into a bundle is fine.

- **Settle the canonical location before you cascade.** Decide where the one
  source lives before wiring consumers or planning cascade waves. Two plans that
  name two destinations for the same data is itself the duplication this rule
  prevents.

- **A divergence is a field, not a fork.** When one consumer needs a different
  view — a subset, an extra trait — express it as a field or filter on the one
  source, never as a second standalone copy.

## The fleet roster, worked

`cascading-fleet/lib/fleet-repos.json` is the one roster of fleet repos. It was
shadowed by three hand-maintained copies: `CANONICAL_FLEET_NAMES` in
`discover.mts`, `FLEET_REPO_NAMES` in `_shared/fleet-repos.mts`, and a stale
`fleet-repos.txt` (12 names where the JSON had 16). They drifted.

Now every consumer derives from the JSON:

- `discover.mts` (a script) reads it and re-applies the cascade order.
- `_shared/fleet-repos.mts` (loaded as a per-hook `.mts`, not bundled)
  static-imports it; Node resolves the import at load.
- The cascade order in `discover.mts` (wheelhouse first, registry second, rest
  alphabetical) is the one thing not stored in the JSON, because it is cascade
  execution order, not roster data. It is re-applied, not re-listed.

## Why

A copy you keep in sync is a copy that falls out of sync. The cost lands later
and somewhere else: a guard that stops matching, a cascade that skips a member, a
release that ships the wrong list. One source removes the sync step. Nothing is
left to keep in agreement.
