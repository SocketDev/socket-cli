# Runtime state & caches

Code that writes per-checkout or runtime metadata — applied-ref markers, fetch
state, memoized lookups, downloaded artifacts — must be deliberate. Scattered,
undocumented, or repo-tracked state turns into drift, dirty worktrees, and
invisible behavior nobody can audit. (Not hypothetical: the bootstrap fetcher's
applied-ref marker first lived at `.config/fleet/.bundle-applied` — inside the
tracked tree — so every thin consumer that ran the fetcher carried it as an
untracked, dirty file.)

## The rules

- **Consolidate.** Prefer ONE state file over a marker-per-fact. If a tool must
  record several facts, record them together (one JSON object), not a sprinkle of
  flag files.

- **Never write runtime state into the tracked tree.** Local/per-checkout state
  belongs out of the repo, so it never dirties a worktree or needs a `.gitignore`
  rule. Two homes, by capability:
  - **Can import socket-lib → `cacache`.** Content-addressable, integrity-checked,
    TTL-capable, lives in the OS cache dir. Use it for anything cache-shaped
    (fetched artifacts, expensive memoized lookups).
  - **dep-0 (can't import socket-lib) → `node_modules/.cache/<name>/`.** The
    standard tool-cache convention: gitignored via `node_modules`, reachable with
    only a path (walk to the nearest `node_modules`). The bootstrap fetcher
    (`bootstrap/fleet.mjs`) runs at `prepare`, BEFORE the payload + socket-lib
    exist, so it is strictly dep-0 — `node_modules/.cache/socket-wheelhouse/` is
    its cacache-equivalent.

- **Call out invisible state LOUDLY.** cacache and `node_modules/.cache` are
  harder to SEE — they are not files in the repo. That invisibility is the
  hazard, not a feature: undocumented cache state is forgotten, surprising when
  stale, and impossible to audit. Every store must be named in "Known state
  stores" below with what it holds, where it lives, its TTL / invalidation, and
  how to inspect or clear it — and pointed at from a comment at the write site.

## Known state stores

- **`bundle.ref`** (`.config/socket-wheelhouse.json`) — a CUSTOM pin (not a
  standard field): the wheelhouse bundle ref (`fleet-<sha>`) a thin consumer
  fetches. The fleet's equivalent of a payload lockfile pin; the version decision
  lives in exactly one auditable place. This one IS tracked — it's config, not
  runtime state.
- **`node_modules/.cache/socket-wheelhouse/bundle-applied`** (dep-0 fetcher
  cache) — the bootstrap fetcher records the `bundle.ref` it last applied so
  `bootstrap/fleet.mjs --if-current` skips a redundant warm fetch in local dev. A
  fresh clone / CI has no `node_modules/.cache`, so the fetch runs. Inspect:
  `cat node_modules/.cache/socket-wheelhouse/bundle-applied`; clear: delete it (or
  the whole `.cache` dir) and the next `prepare` re-fetches. The fetcher migrates
  away the legacy in-tree `.config/fleet/.bundle-applied` on write.
