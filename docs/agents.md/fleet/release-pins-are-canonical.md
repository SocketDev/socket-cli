# Release pins are canonical — aliases never persist

An alias (`latest`, `main`, `head`, `stable`, `newest`, a range like `^`/`~`/`*`)
is a **user-input convenience only**. Resolve it to its exact canonical form at
the input boundary; never write it into a committed release pin or manifest. A
persisted pin stores **only exact canonical values**.

## The canonical forms

- `bundle.ref` — an exact `fleet-<hex>` release tag (`fleet-a1b2c3d`). No semver,
  no range, no `latest`/`main`/`stable`/`newest` alias.
- `bundle.cascadeSha` — a bare 40-hex git SHA (lowercase, no `v` prefix, no
  range, no alias). A manifest's `templateSha` is the same shape.
- No pin stores **both** an alias and its canonical form. Any field beside `ref`
  and `cascadeSha` in a `bundle` block is an alias that leaked into storage.

## Where the rule is enforced

Two layers, deliberately paired (code-is-law):

- **Write time** — `bootstrap/src/lockstep.mts` (`validateRef` /
  `validateCascadeSha`, the dep-0 fetcher) and
  the cascade stamper's config module (`validateBundleBlock`, in the
  template source's `scripts/repo/sync-scaffolding/`) reject a
  fuzzy/ranged/aliased pin
  as it is written. The stamper writes exactly `{ ref, cascadeSha }` and refuses
  to invent a ref (see `fix-bundle-pin.mts`).
- **Belt** — `scripts/fleet/check/release-pins-are-canonical.mts` re-asserts the
  invariant over the **committed** tree: the effective
  `.config/…/socket-wheelhouse.json` `bundle` block and any git-tracked
  `release-bundle-manifest.json`. This catches a pin hand-edited past the write
  gate, or a member config that predates it. It does not relax or duplicate the
  write-time shape check — it re-asserts it, and additionally names `stable` and
  `newest` — the two alias tokens this discipline calls out — and flags an alias
  stored beside a canonical value.

The check runs on every `check --all` — a pure local read. It is a vacuous pass
where nothing is pinned — the wheelhouse producer, a non-thin member — and never
false-greens.

## Why aliases can't persist

The release bundle is deterministic: a member's pinned `bundle.cascadeSha` must
equal the `templateSha` of the release at `bundle.ref` (the lock-step invariant,
see [`thin-distribution.md`](thin-distribution.md)). A fuzzy ref resolves
differently over time, so the pin would silently drift and the lock-step verify
could no longer hold. Keeping the ergonomics at the input layer and persisting
only exact values is what keeps the bundle reproducible.

## The pure core

`classifyReleasePin(label, pin)` classifies a pin object into findings without
touching the filesystem (`ref` shape, SHA shape, and "no alias beside canonical"
via the extra-key rule). `manifestPinFields(manifest)` extracts only the
pin-bearing fields of a manifest so the classifier never false-positives on a
free-text field (e.g. a `$schema` URL that contains the path segment `main`).
Both are unit-tested in `test/repo/unit/release-pins-are-canonical.test.mts`.

## See also

- [`thin-distribution.md`](thin-distribution.md) — the bundle-pin + lock-step
  invariant this canonicality rule protects.
- [`lockstep.md`](lockstep.md) — the separate upstream-drift harness (same word,
  different subsystem).
