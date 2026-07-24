# Generated files are never gated

Generated, vendored, and dep-0 artifacts are **never format- or lint-gated** — in
any scope, including `lint --staged` / explicit-file runs and the wheelhouse
`template/` dogfood pass. Their bytes belong to a bundler, a codegen step, or an
upstream source of truth; the gate rewriting them is churn against the next build
(or, worse, a broken artifact — a formatter reflow once ASI-mangled the dep-0
`bootstrap/fleet.mjs` into `const line = lines[i]if (…)`).

## The mechanism

`oxlint` and `oxfmt` honor their `ignorePatterns` / `--ignore-path` only during a
directory **walk**. When a file is passed **explicitly** on the argv — which is
exactly what `lint --staged`, `lint <file>`, and the pre-commit hook do — the
tool lints/formats it regardless of the ignore. So a staged generated file
(`bootstrap/fleet.mjs`, a `dist/` bundle, the vendored `acorn` AST tooling)
red-lights the gate on bytes it never owns.

The fix is to pre-filter the file list before it reaches the tool.
`isNeverGated()` in `scripts/fleet/_shared/format-scope.mts` is the single
predicate; `filterFormatIgnored()` applies it **before** the `template/**` keep,
so the artifacts drop out even inside the wheelhouse canon. It covers:

- the dep-0 fetcher bundle (`bootstrap/fleet.mjs`) — `bootstrap/src/*` IS gated;
- `.d.ts` / `.d.mts` / `.d.cts` compiler output;
- `_dispatch/` hook bundles and gh-aw `*.lock.yml` compiled workflows;
- directories a generator or upstream owns: `acorn`, `build`, `coverage`, `dist`,
  `external`, `fixtures`, `out`, `third_party`, `upstream`, `vendor`.

The **mirror** exclusions (`.claude/`, `.agents/`, `**/fleet/**`) are deliberately
NOT in `isNeverGated` — `template/` dogfoods those (they are the canon every
member mirrors), so they stay gated at the wheelhouse source.

## Generate them compliant

The corollary: a generator writes output that already passes the gate, so it never
needs to be linted. `gen/bootstrap.mts` runs `format.mts` on its bundle
as the last build step; codegen steps self-format the same way (`code-first-then-ai`:
repair the generator's format call, never hand-format the artifact). If a generated
file is dirty against the gate, fix the generator — do not add it back to the walk.

## Keeping the lists aligned

`.config/fleet/.prettierignore` and `scripts/fleet/constants/generated-globs.mts`
are the twins `scripts/fleet/check/generated-globs-are-consistent.mts` enforces;
`isNeverGated()` mirrors their generated/vendored subset (plus the vendored
`acorn`/`fixtures` trees the mirror-`**/.claude/**` glob otherwise hides). When you
add a new generated tree, update the constant + the ignore, then extend
`isNeverGated()` so explicit/staged runs drop it too.
