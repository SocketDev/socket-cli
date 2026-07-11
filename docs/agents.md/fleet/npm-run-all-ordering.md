# npm-run-all2 task ordering

## The hazard

`run-s name:*` and `run-p name:*` expand the glob via `Object.keys(scripts)` in
npm-run-all2's `read-package-json.js`. Per ECMA-262 OrdinaryOwnPropertyKeys
(§10.1.11), `Object.keys` returns non-array-index String keys in ascending
chronological order of property creation — i.e. the order properties appear in
the JSON source, not alphabetical order.

An aggregator like `run-s gen:*` silently runs tasks in the order they were
written in `package.json`. If `gen:showcase` appears before `gen:socket-icon` in
the source, the glob runs the sheet before the icons it reads exist — producing
a corrupt output with no error.

## The fix

- **Order-dependent aggregators list tasks explicitly:**

  ```json
  "gen": "run-s gen:logo gen:socket-icon gen:showcase"
  ```

  not:

  ```json
  "gen": "run-s gen:*"
  ```

- **Order-independent aggregators may use a glob** when every task under the
  prefix is a standalone pass (e.g. `run-s lint:*` where each linter is
  independent). Add an inline comment to assert it:

  ```json
  "test:all": "run-s test:*"
  ```

  with a comment in the vicinity: `# order-independent — each suite is isolated`.

## Enforcement

| Tier | Artifact | What it catches |
| --- | --- | --- |
| Rule doc | `.claude/rules/fleet/npm-run-all-ordering.md` | The rule for AI sessions |
| Lint rule | `socket/no-glob-in-ordered-run-s` | `:*` globs in `run-s`/`run-p` string literals in `.ts`/`.mts` source files |
| Edit guard | `.claude/hooks/fleet/no-glob-run-s-guard/` | Writing a new `:*` glob into a `package.json` |
| Check script | `scripts/fleet/check/run-s-globs-are-explicit.mts` | Any `:*` glob in every fleet `package.json` (full-scan, CI gate) |

The check script is the authoritative fleet-wide sweep. The guard blocks
introduction at edit time. The lint rule catches patterns transcribed into
TypeScript source (e.g. a helper that assembles a `run-s` command string).

## Current fleet status

The wheelhouse's own `package.json` has two glob aggregators:
`run-s install:*` and `run-s setup:*`. Both are order-independent (each
`install:*` / `setup:*` task targets a disjoint tool) and annotated as such.
The `gen` aggregator deliberately lists tasks explicitly for this reason.
