# Dependency spec pinning

Every fleet dependency spec is a pin. Among the pinned forms the fleet has a
preference order, and the tooling states it in that order everywhere.

## Preference order

1. **`catalog:`** - PREFERRED. A catalog entry is exact-pinned in
   `.config/fleet/pnpm-workspace.fleet.yaml`, so `catalog:` pins as hard as a
   literal version while keeping one bump site: a single catalog edit upgrades
   every repo that references it.
2. **`1.2.3`** (or `npm:other@1.2.3`) - an exact published version. Correct and
   fully pinned, but it costs a manifest bump in every dependent on each
   release. Use it when the package does not belong in the fleet-wide catalog.
3. **`workspace:1.2.3`** - FALLBACK only, for an intra-repo package that
   genuinely cannot be published. Legal, never blocked, and reported by the
   check as the `catalog:` conversion backlog. Every sibling release forces a
   manifest bump in each dependent, which is exactly the cost `catalog:`
   removes. Reaching for it because a sibling is unpublished means the real
   task is publishing the sibling.

## Blocked forms

- **`workspace:*`, `workspace:^`, `workspace:^1.2.3`, `workspace:~1.2.3`** - a
  range floats. Which sibling version an install resolves depends on the tree
  it runs against, and pnpm expands the range at publish time into a range
  every consumer inherits.
- **`link:`** - the dependency resolves to a local directory, which means the
  package it names is unpublished. This is release work, not cleanup: publish
  the package, then route it through the catalog.
- **`file:`** - disallowed outright, tracked target or not.
- **Bare registry ranges** (`^1.2.3`, `~1.2.3`, `>=5.0.0`, `a || b`) are
  classified and reported, but staged out of the gate while the fleet's
  remaining ranges convert. `isBlockingSpecKind` in
  `.claude/hooks/fleet/_shared/dependency-spec-forms.mts` is the seam.

## peerDependencies are exempt

A peer dependency states the span of host versions a package supports, so a
range there is the correct expression rather than a missing pin. The exemption
is permanent and applies to the range classes only - a `link:`/`file:` spec in
`peerDependencies` still blocks.

## Enforcement

- `.claude/hooks/fleet/link-protocol-dep-guard/` blocks an Edit/Write that adds
  a `link:`/`file:` spec or a `workspace:` range to a `package.json`.
- `scripts/fleet/check/dependency-specs-are-registry-or-workspace.mts` gates the
  committed state across every tracked `package.json` and `pnpm-lock.yaml`, and
  prints the two advisory tiers.
- Both read one classifier,
  `.claude/hooks/fleet/_shared/dependency-spec-forms.mts`, so the edit-time and
  commit-time tiers cannot drift.
