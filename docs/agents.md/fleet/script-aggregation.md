# Script aggregation — pnpm-native, no npm-run-all2

The fleet aggregates package.json scripts with pnpm's own machinery.
npm-run-all2 (`run-s` / `run-p`) is removed fleet-wide: its dep, its catalog
pin, and its glob-ordering guard family are gone, and the package-scripts
check fails any script body that reintroduces `run-s` / `run-p` /
`npm-run-all`.

## The two forms

- **Order-independent group** → pnpm's regexp form:
  `pnpm run "/^install:/"`. Verified against pnpm 11: matched scripts run
  **CONCURRENTLY** — all start together, completion order is
  nondeterministic. That makes the regexp form a drop-in for the old `run-p`,
  and categorically wrong for ordered work.
- **Order-dependent chain** → explicit `&&` chain:
  `pnpm run gen:logo && pnpm run gen:socket-icon && …`. The order is visible
  in the script body itself, which is what the old glob-ordering rule always
  demanded ("list tasks explicitly") — now it is the only way to express
  order at all.

## Choosing

Ask: does any step read another step's output? Yes → `&&` chain. No →
regexp, and keep the name prefix tight enough that a future script can't
accidentally join the group (`/^install:/` joins every future `install:*`
script — that is a feature for true groups and a hazard for curated ones;
curate with an anchored alternation like `/^(install:a|install:b)$/` when
membership must be closed).

## Why npm-run-all2 left

Its `run-s name:*` globs resolved in package.json source order (ECMA-262
OrdinaryOwnPropertyKeys), breaking on any reorder — the fleet carried a
three-piece guard family (check + edit hook + lint rule) to police that.
pnpm's regexp form has no ordering pretense (concurrent, always), and `&&`
chains carry their order in plain sight, so the entire hazard class and its
policing apparatus retire together.
