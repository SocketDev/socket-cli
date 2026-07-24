# No deprecation — delete, don't deprecate

The fleet does not deprecate. There is **no `@deprecated` marker, no legacy
fallback, no back-compat alias** kept "until consumers migrate." When a thing is
replaced or removed, it and every one of its call sites go in the same change.

## The rule

- **Delete the code, rewire the callers — in one change.** Replacing `foo` with
  `bar`? Delete `foo`, update every `foo` call to `bar`, done. Do not leave `foo`
  in place wearing a `@deprecated` tag that forwards to `bar`.
- **No `@deprecated` / `@obsolete` markers.** A deprecation annotation is a
  promise to delete later that never gets kept — it accretes. If it's deprecated,
  it's deletable now.
- **No legacy fallback.** Don't keep an old code path "in case" — no
  `if (oldShape) { … } else { … }` retained purely to tolerate a format you've
  stopped producing, no `.config/<old>` fallback for a config you've fully
  relocated. Migrate 100%; delete the old path.
- **No back-compat alias.** Don't keep `export const OldName = NewName` or an
  empty `export const SHARED_X = []` "retained only for importers that still
  spread it." Update the importers and delete the alias. An empty-array alias
  spread is a no-op the caller can drop outright.
- **The comment states the present.** Don't narrate the removal at the deletion
  site ("used to be X", "replaced the old Z") — that's the
  `no-removal-comment-nudge` rule. Describe what the code IS.

## Enforcement

- `socket/no-deprecation` (oxlint) fires on the machine-checkable signal: a
  `@deprecated` (or `@obsolete`) annotation in a comment. It matches the
  annotation FORM only — a line whose first non-comment token is the tag
  (`* @deprecated`, `// @deprecated`, `/** @deprecated */`) — so an inline prose
  mention of the word in a doc does not trip it. Report-only:
  removing deprecated code + rewiring its callers is not a mechanical autofix.
- Test files (`*.test.*`) are exempt — fixtures legitimately embed the marker.
- The broader "no legacy fallback / no alias" half is doctrine, not a lint rule:
  a fallback branch or an alias export is too semantic to flag precisely without
  drowning in false positives on the words "legacy"/"alias"/"fallback." Enforced
  by review against this doc and the CLAUDE.md bullet.

## Bypass

`// socket-lint: allow deprecated-marker` on the offending line — reserved for
the rare case of a comment quoting an upstream API's own `@deprecated` tag
verbatim. Deprecating fleet code is never a valid reason.

## Why

A deprecation marker is deferred deletion, and deferred deletion is
never-deletion: the marker outlives the migration, the "legacy" branch calcifies
into load-bearing, the alias gets new call sites. The fleet has no external
consumers to protect with a migration window — it cascades. So the honest move is
the immediate one: delete the thing, fix the callers, ship it. (Incident: an
empty `SHARED_SKILL_FILES` alias was kept `@deprecated` "until consumers stop
spreading it" — the consumers spread an always-empty array, a no-op; deleting the
export and dropping the spreads was the whole migration.)
