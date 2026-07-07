# npm-run-all2 task ordering

`run-s name:*` expands via `Object.keys(scripts)`, which follows ECMA-262
OrdinaryOwnPropertyKeys §10.1.11 — **package.json source order, not alphabetical**.
An order-dependent aggregator using a glob silently runs tasks in the order they
were written, breaking on any reorder or insertion.

## The rule

- **Order-dependent `run-s` aggregators must list tasks explicitly** — never
  `run-s gen:*` when one task reads another's output; write `run-s gen:logo gen:socket-icon gen:showcase`.
- A `name:*` glob is only safe when every task under the prefix is order-independent
  (e.g. `run-s lint:*` where each linter is a standalone pass). Add an inline
  comment asserting order-independence when you leave a glob: `# order-independent`.
- The static check (`scripts/fleet/check/run-s-globs-are-explicit.mts`) flags
  `run-s`/`run-p` `:*`-glob aggregators in every fleet `package.json`; the edit-time
  guard (`no-glob-run-s-guard`) blocks introducing new ones in package.json;
  the lint rule (`socket/no-glob-in-ordered-run-s`) catches the pattern in
  `.mts`/`.ts` source strings.

## Why

npm-run-all2 builds its task list as `Object.keys(body.scripts)` in
`read-package-json.js`. Per ECMA-262 §10.1.11, `Object.keys` returns non-array-index
String keys in ascending chronological order of property creation — i.e. the order
properties appear in the JSON source. A `gen:showcase` entry that precedes
`gen:socket-icon` in package.json source runs before it under a glob, producing a
corrupt output (the sheet reads icon files that don't exist yet). This is not
alphabetical, not deterministic across reorders, and not caught by tests unless
the integration test mirrors the wrong order too.
