# Published dist is readable — no maps, no minify

A fleet member that ships a bundled `dist/` (rolldown) publishes **readable,
unobscured code**. Socket ships code an operator can actually read and audit —
never a minified blob, never a tarball carrying source maps.

## Scope

The check only activates when a repo actually publishes a bundled dist:

- `package.json` `files` includes `"dist"`, AND
- a rolldown/rollup config exists (repo root, or under
  `.config/{fleet,repo}/`) — the same two-signal shape
  `dependencies-are-deduped.mts`'s `repoUsesRolldown` gates cross-major dedup
  enforcement on.

Outside that scope, or when `dist/` hasn't been built yet (a lint/type CI lane
that never runs the build step), the check is a vacuous pass — it never false-
blocks an unbuilt tree.

## The three assertions

1. **No `*.map` file** anywhere under a publishing package's `dist/`. A source
   map in the tarball leaks the original sources and bloats the artifact — it
   must never reach what gets published.
2. **The built output is not minified.** Heuristic: sample up to
   `SAMPLE_FILE_COUNT` files under `dist/**/*.{js,mjs,cjs}` and flag one whose
   average line length exceeds `MAX_AVG_LINE_LENGTH` (300). Calibrated against
   socket-lib's own unminified dist (~40 chars/line, ~7x headroom) and verified
   against real minified output (tweetnacl / protobufjs: ~9,000-19,000
   chars/line) — the two are separated by more than an order of magnitude, so
   the threshold doesn't need to be exact. A single-megaline file is the
   degenerate case of the same formula (the "average" of one line is the
   line's own length), so no separate near-zero-newline branch is needed.
3. **The bundler config pins `minify: false` explicitly** — a literal grep for
   the token, not an AST parse or a dynamic import of the config. This is an
   honest content check ("does this config text contain the literal pin?"),
   the same class of check as "does package.json contain X?" — not an
   inference of what the config's code *does*, so it doesn't fall under the
   `no-source-sniffing` prohibition on grepping source text to guess behavior.

## Where it's enforced

Two layers, deliberately paired (code-is-law):

- **Author time** — the `no-minified-bundler-output` oxlint rule flags (and
  autofixes) a bundler config that doesn't pin `minify: false` /
  `sourcemap: false`, the moment the config is written or edited.
- **Release time** — `scripts/fleet/check/published-dist-is-readable.mts`
  re-verifies the same pin, plus the two assertions author-time linting can't
  make at all: the *actual built artifact* has no maps and isn't minified. A
  config can pin `minify: false` and still ship a stale, pre-pin `dist/` if
  the build wasn't re-run — this check catches that gap.

Wired into `check-steps-release.mts` (`releaseStep`, so it runs only on the
release/CI tier, never the interactive inner loop).

## Rollout

Report-only for now (`MODE = 'report'`, exits 0 and lists findings) — the
`member-ci-fires-on-push` / `published-packages-have-files-field` rollout
pattern. Flip to `'strict'` once any pre-existing fleet backlog clears, so a
day-one violation can't ship red fleet-wide.

## The pure core

`publishesDist`, `findBundlerConfig`, `bundlerPinsNoMinify`, `walkFiles`,
`isLikelyMinified`, and `checkDistDir` are pure — no process exit, no global
state — so `collectFindings(repoRoot)` drives the full scan against a fixture
repo in `test/repo/unit/check-published-dist-is-readable.test.mts` without
touching a real build.
