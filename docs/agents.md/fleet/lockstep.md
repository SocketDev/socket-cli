# Lockstep — upstream drift tracking

Companion to the `### Drift watch` rule in `template/CLAUDE.md`. The lockstep
harness is a read-only drift detector for a repo's upstream relationships:
vendored file forks, pinned submodules, behavioral reimplementations, spec
conformance, and sibling language ports. One manifest declares what must stay
in step; `pnpm run lockstep` reports where it hasn't.

Not to be confused with `bootstrap/src/lockstep.mts`, which enforces the
thin-distribution bundle-pin invariant (`bundle.cascadeSha === templateSha`) —
same word, different subsystem (see
[`thin-distribution.md`](thin-distribution.md)).

## The manifest

- **Location.** `resolveManifestRoot` (`scripts/fleet/lockstep/manifest.mts`)
  reads `<repo-root>/lockstep.json` when present, then the segregated
  `.config/repo/lockstep.json`, then legacy loose `.config/lockstep.json`. The
  manifest is repo-owned content — rows differ per repo, so it lives under
  `.config/repo/`
  (`scripts/repo/sync-scaffolding/manifest/files.mts`, `EXPECTED_FILES`
  comment). Empty `rows: []` is valid for repos with no upstream ties.
- **Schema.** `scripts/fleet/lockstep/schema.mts` is the TypeBox single source
  of truth; everything derives from it: TS types via `Static<typeof …>`, the
  fleet-identical editor-facing `.config/fleet/lockstep.schema.json` (emitted by
  `pnpm run lockstep:emit-schema`, never hand-edited), and runtime validation
  via `validateSchema` (`manifest.mts:41`). A schema failure exits 1 with a
  per-issue error trail.
- **Sub-manifests.** A root manifest's `includes[]` carves large concerns into
  `lockstep-<area>.json` files; `loadManifestTree` merges rows and unions
  `upstreams`/`sites` maps (top-level wins on key conflict, null-prototype
  maps against pollution — `manifest.mts:92-145`). An included file's `area`
  defaults to its filename stem with the `lockstep-` prefix stripped.
- **Top-level maps.** `upstreams` names each submodule + its repo URL
  (`schema.mts:92-112`); rows reference upstreams by key, and the harness
  errors on a dangling reference. `sites` names sibling language ports for
  `lang-parity` rows (`schema.mts:114-132`).

## The five row kinds

The `kind` literal on each row is the dispatch key (`schema.mts:168-183`,
dispatcher in `cli.mts:54-95`; an unknown kind is an error, never a silent
skip):

- **`file-fork`** — a local file derived from an upstream file, with a
  mandatory non-empty `deviations` list ("zero deviations = don't fork,
  consume upstream directly" — `schema.mts:206-210`). Drift = upstream commits
  on `upstream_path` since `forked_at_sha`
  (`git log <sha>..HEAD -- <path>` inside the submodule, `checks.mts:90-102`).
  A missing local/upstream file or an unreachable SHA (too-shallow submodule)
  is an error, not drift (`checks.mts:71-88`).
- **`version-pin`** — a submodule pinned to `pinned_sha` (full 40-hex,
  authoritative; `pinned_tag` is informational — `schema.mts:227-237`). The
  submodule HEAD must equal the pin or the row errors ("run
  `git submodule update`", `checks.mts:153-159`). Before counting, the checker
  runs a best-effort `git fetch --tags` in the submodule — `fetchTagsQuiet` in
  `git.mts` — so a shallow or never-fetched clone can't under-report against a
  STALE remote ref, the opentui trap where drift read "1 commit" while the true
  gap was 211. Drift = commit count from the pin to the refreshed
  `origin/HEAD|main|master` ref; a shallow clone, or one with no fetched remote
  ref, reports drift UNKNOWN and LOUD — an error naming
  `git fetch --tags`/`--unshallow`, never a falsely-low count that reads clean
  (`checks.mts` `checkVersionPin`, `git.mts` `isShallowRepo`).
  `upgrade_policy` picks the auto-bump behavior: `track-latest`, `major-gate`
  (patch/minor auto, major advisory), or `locked` (report-only,
  `schema.mts:238-248`).
- **`feature-parity`** — a local reimplementation scored on three pillars:
  code patterns 30% + test patterns 30% + fixture/snapshot 40%; a row drifts
  below the floor `min(0.85, criticality/10)` (`checks.mts:294-306`).
- **`spec-conformance`** — a local implementation of an external spec;
  existence checks on `local_impl` and the optional in-submodule `spec_path`
  (`checks.mts:309-347`).
- **`lang-parity`** — N sibling ports of one behavior. Every declared site
  needs a port entry and vice versa; `opt-out` requires a reason
  (`checks.mts:365-389`). `category: 'rejected'` is reserved for
  anti-patterns: every port must be `opt-out`, and a port flipping to
  `implemented` drifts as "rejected anti-pattern reintroduced"
  (`checks.mts:391-401`).

`checkCrossRowConsistency` (`checks.mts:417-467`) layers referential integrity
on top of schema validation: ids unique per area (not globally), `upstream`
refs resolve, port keys match `sites`. Behavior receipts:
`test/repo/unit/checks-git.test.mts` (file-fork + version-pin against real
temp git repos), `checks-scoring.test.mts` (parity floors, spec-conformance,
lang-parity), `checks.test.mts` (cross-row + lang-parity).

## Materialization — lock-step vs adapt-step

A `version-pin` row carries an optional `materialization` field — how much of
the pinned submodule this repo consumes. It is one mechanism with two modes, not
two systems: both share the same pin, `.gitmodules` `sha256:`, drift-count, and
latest-release machinery; only the _take_ differs (`schema.mts`
`MaterializationSchema`). (`file-fork` is inherently a single-file subset, so it
carries no `materialization` field.)

- **`full` (default when omitted) — lock-step.** Consume the WHOLE upstream and
  keep every consumer on the same pin, fleet-uniform. Any divergence between two
  consumers is a defect. This is the historical behavior, so every existing row
  is `full` without stating it. Use for a reusable workflow, a conformance
  submodule, or a whole-toolchain pin.
- **`sparse` — adapt-step.** Consume only a sparse-checkout cone / inlined
  subset of the SAME pin — git's own sparse-checkout + partial-clone idea, "take
  what you want, leave the rest." Lighter, drift-stable across dev machines, and
  minimal surface. Name the cone in `sparse_cone` (the upstream paths actually
  taken). Use when the whole thing exceeds the need or resolves differently per
  environment — e.g. a fleet composite action that inlines only one code path of
  an upstream action, or a platform lock scoped to just the targets shipped.

The harness makes `sparse` real: `checkVersionPin` scopes the drift count to the
`sparse_cone` paths (`git rev-list --count <pin>..<branch> -- <cone>`), so
upstream commits outside the cone are not drift. A `sparse` row with no
non-empty `sparse_cone` is a cross-row validation error — the cone is what
defines the drift scope. Both modes still obey "pin the latest release" below
and the shallow-clone drift backstop; `sparse` narrows what you vendor and what
counts as drift, never how the pin itself is tracked.

## Conformance via upstream test reuse

A `feature-parity` port or a `spec-conformance` implementation reimplements
an upstream project, so its conformance gate reuses the upstream's OWN test
suite instead of hand-porting it. Four rules, all mandatory — each proven in
production by the stuie port, opentui to Rust at 170/170 upstream
conformance:

1. **Drive the upstream suite through a shim; never rewrite it.** Expose the
   local port under the upstream's exact public API through an adapter — a
   napi shim for a native port, a thin re-export module for a JS port — then
   run the upstream's own test files against it with a harness that aliases
   the upstream's module imports to the shim. Hand-porting or paraphrasing
   the tests is forbidden: a paraphrase drifts from the source the instant
   upstream changes and silently drops every case you did not copy. Build a
   bespoke runner ONLY where the upstream harness genuinely cannot be driven
   directly, such as a non-standard runner or an embedded DSL; that runner
   follows the [`conformance-runners`](conformance-runners.md) shape. The
   payoff: a `version-pin` or parity bump re-runs the upstream's NEWEST tests
   against the port for free — reproducible, deterministic, auto-updating.
2. **Alias by on-disk overlay, never by loader plugin.** The alias mechanism
   is a real re-export stub file written OVER the upstream module inside the
   throwaway sandbox copy — `export * from "<abs shim path>"` — so the
   runtime's own loader resolves it, which works identically for sync,
   async, dynamic, and child-process imports. NEVER redirect upstream module
   imports via a Bun runtime-plugin `onResolve` returning a shim path: Bun,
   observed at >= 1.3.11, misredirects async/dynamic imports and export-star
   re-exports of a plugin-returned path — it builds `file:<path>` then fails
   ENOENT (<https://github.com/oven-sh/bun/issues/9863>). Custom overlay
   bodies handle default-export forwarding and circular injection. Keep the
   overlay map declarative in one file.
3. **Run a full physical copy from `os.tmpdir()`; never in the upstream
   tree.** A pinned submodule is read-only truth; a test's side effects —
   snapshot writes, temp files, runner scratch — must never dirty it, since
   a dirty submodule breaks the `version-pin` HEAD check and the
   `.gitmodules` hash. The harness therefore COPIES the upstream src plus
   the test files into a throwaway sandbox under `os.tmpdir()`, runs them
   from there, and deletes the dir afterward. The physical copy is
   load-bearing: relative imports stay contained inside the sandbox, while
   a symlink farm escapes back into the real tree because loaders realpath
   by default. Stage unvendored bare-specifier deps as stand-in packages
   under the sandbox `node_modules`. For suites that spawn CHILD bun
   processes, write a `bunfig.toml` at the sandbox root pointing `preload`
   at an absolute path — children discover it from cwd, and the on-disk
   overlays are inherited for free. The module-under-test import still
   resolves to the shim by ABSOLUTE path, so moving the test files never
   breaks the alias. Fleet helpers: `getTmpdir()` from
   `@socketsecurity/lib-stable/env/temp-dir`, which returns `undefined` on a
   locked-down host, so fall back to `os.tmpdir()`; `copy` from
   `@socketsecurity/lib-stable/fs/copy` for the file copy; and `safeDelete`
   from `@socketsecurity/lib-stable/fs/safe` for cleanup. Never spawn the
   upstream runner with its cwd inside `upstream/<name>/`.
4. **Stand-ins must share module identity with the sandbox barrel.** When a
   test asserts a package equals the barrel via reference-based `toEqual`,
   the bare-specifier stand-in must re-export the SAME module instance as
   the sandbox barrel — `export * from "<relative path into sandbox src>"`
   — never a parallel copy of the shims, which fails identity even when the
   exports match shape-for-shape.

Enforcement today is this doctrine plus the CLAUDE.md conformance bullet. A
mechanical guard that flags a test-runner invocation whose path points inside
an `upstream/` submodule without a tmp copy is future work: a robust check is
false-positive-prone across the many runner shapes, so correctness wins over a
flaky gate.

## Closing port gaps

How a port fix lands once drift surfaces — a `version-pin` bump breaking the
gate, a parity-floor breach, a red conformance suite. Same provenance as the
harness rules above: each rule was validated in production by the stuie port.

- **Upstream ground truth first.** Before fixing any gap, derive upstream's
  ACTUAL behavior from its sources with file:line evidence, then implement
  what the evidence shows — mirror, never invent. Any deliberate divergence
  is explicit, documented at the site, and reported. Receipts: the stuie
  editor cluster-math fix was confirmed cluster-wise in upstream zig before
  porting, and the yoga clippy pass rejected a plausible-but-wrong epsilon
  fix the same way.
- **Gaps with no upstream test pressure gate on OUR adversarial tests.**
  When upstream tests never exercise the gap, write unit tests that
  demonstrably FAIL on the old code — prove it with a targeted revert probe
  — and include property-style invariants, e.g. N steps right then N left
  returns to origin.
- **Adversarial verify between implement and land.** Every tier lands
  through an independent verify pass that re-derives claims itself: re-runs
  benches on a clean HEAD worktree, re-reads upstream sources, revert-probes
  new tests, checks `git status` for strays, and confirms exact-baseline
  conformance on >= 2 stable runs of the final tree. Fix-is-real means real
  resolution or computation — never a loosened assertion or an edited
  snapshot. The general loop lives in
  [`adversarial-self-review.md`](adversarial-self-review.md).
- **Hard time-boxes; revert + defer.** Cap fix attempts at ~6-8 iterations,
  then REVERT and defer with an accurate note: what broke, which impls, the
  suspected upstream change. Never trade green suites, never grind. Test
  harnesses set hard per-command timeouts — `spawnSync` `timeout` — so a
  hung worker fails fast instead of stalling verification.
- **Perf rewrites in ports.** Measure first in release mode, capture the
  baseline BEFORE touching loops, keep an honest before/after table, revert
  wins below ~1.3x. Pin semantics with randomized naive-reference
  equivalence tests kept in the test module. Microarch policy is
  [`portable-microarch.md`](portable-microarch.md) — runtime dispatch for
  distributed targets, floor pins only for controlled ones.

## Verbatim mirrors — the `@lockstep-mirror` exemption

Some `file-fork` copies are **verbatim upstream mirrors**: kept byte-close to
their upstream source so they stay trivially diffable on the next bump. The
canonical case is a conformance shim that re-exposes upstream's public API so
upstream's OWN test suite runs against a port — the upstream test does
`import Yoga from "../../yoga.js"`, so the mirror must keep upstream's default
export, its file/dir names, its 1400-line single-unit shape, and its idioms.
That legitimately fights the fleet fidelity rules — `no-default-export`,
`max-file-lines`, the `sort-*` family, `prefer-undefined-over-null`,
`prefer-node-builtin-imports`, `export-top-level-functions`,
`prefer-function-declaration` — and oxfmt.

A mirror declares itself with ONE header line in its leading comment block, the
single-file analogue of the multi-file `BEGIN LOCK-STEP HEADER` block:

```ts
// @lockstep-mirror packages/core/src/lib/yoga.ts @ 0c8c4f7cff2927e3df63a9757a45eff9a343611c
```

`<upstream-path>` is the path inside the upstream submodule, matching the
covering row's `upstream_path`; `<sha>` is the 40-hex commit the mirror was
copied at, matching `forked_at_sha`. Grammar + parser live once in the oxlint
plugin's `lib/comment-markers.mts`; the rule-facing `isLockstepMirror(context)`
and the one-source `LOCKSTEP_MIRROR_EXEMPT_RULES` list live in
`lib/lockstep-mirror.mts`.

How the exemption is bounded — it is NOT a blanket dir ignore:

- **socket/\* rules self-exempt.** Each fidelity rule calls
  `isLockstepMirror(context)` and returns no visitors on a marked mirror — the
  same shape as the `isConfigEntrypoint` guard. A rule that never consults it
  can't be silenced by the marker.
- **Core rules the fleet doesn't own** — e.g. `curly` — route through a
  file-scope `oxlint-disable` that `no-file-scope-oxlint-disable` PERMITS only
  when every named rule is in `LOCKSTEP_MIRROR_EXEMPT_RULES`.
- **Format** is skipped via a manifest-derived, `**`-anchored block in
  `.config/fleet/.prettierignore` between `# BEGIN lockstep-mirrors (generated)`
  and `# END`. Regenerate with `pnpm run lockstep:emit-mirror-globs`; a comment
  can't blanket a 1400-line file because oxfmt only honors per-node
  `// prettier-ignore`.

Declare a mirror by adding `mirror: true` to its `file-fork` row and the header
marker to the file, then running `pnpm run lockstep:emit-mirror-globs`. A
deviating fork — mouse-parser and friends — stays `mirror: false` and may NOT
carry the marker. `scripts/fleet/check/lockstep-mirror-markers-are-declared.mts`
gates both directions: a marked file with no covering `mirror: true` row, or a
marker whose path/sha disagrees with the row, fails; and a `mirror: true` row
missing its marker or its .prettierignore entry fails. It also re-asserts that
a file-scope disable on a mirror names only exempt rules. So the exemption can't
be pasted onto an arbitrary file and can't silently drift from the pin.

## Pin the latest release — always

Porting an upstream means the LATEST shipped release, not a stale or inherited
pin. Before adding or changing a `version-pin` row or a `.gitmodules` submodule
pin:

1. `git fetch --tags` in the submodule so the local view is current.
2. Pin the NEWEST release tag — `gen/gitmodules-hash.mts --set` for
   `.gitmodules`, the `version-pin` row for `lockstep.json`.
3. Never port against a stale/inherited pin, and never trust a drift count from
   a clone that hasn't fetched tags — a shallow or never-fetched clone reports a
   falsely-low number.

Enforced at edit time by `.claude/hooks/fleet/latest-release-pin-guard/`, which
fetches the upstream's tags with `git ls-remote --tags` when a pin is set or
changed and blocks a pin older than the newest release, naming the newer one.
The `checkVersionPin` drift path is the CI-side backstop: it fetches tags before
counting and reports drift UNKNOWN rather than a stale count. Motivating
incident: an opentui pin at v0.1.99 — 211 commits and 3 minor releases behind
v0.4.5 — against which ~31k lines were ported before the drift was noticed. The
fleet-wide framing lives in [`drift-watch.md`](drift-watch.md).

## Running it

`pnpm run lockstep` (shim `scripts/fleet/lockstep.mts` →
`scripts/fleet/lockstep/cli.mts`), `--json` for machine output. Exit codes
(`cli.mts:13-15`): 0 = clean; 1 = broken manifest / missing file / unreachable
baseline; 2 = drift. Exit 2 is a legitimate signal for a human or the
auto-bump flow, not a CI failure — lockstep is not part of `check --all`.

## Auto-bump flow

`scripts/fleet/lockstep/auto-bump.mts` is the deterministic half the
`updating-lockstep` skill (and step 1 of the weekly-update deterministic
chain, `scripts/fleet/weekly-update/deterministic-chain.mts`) drives:

- **`--plan --report <report|->`** partitions a `pnpm run lockstep --json`
  report into `auto` rows (version-pin with an actionable policy, each with a
  resolved `targetTag` or a default-branch `targetSha` for tagless
  track-latest rows) and `advisory` rows (everything else —
  `auto-bump.mts:225-296`). The tag resolver filters pre-release tags,
  constrains candidates to the pinned tag's scheme prefix (an unparseable or
  multi-scheme tag set goes to a human — downgrade vector), and holds major
  bumps under `major-gate` (`auto-bump.mts:145-215`).
- **`--apply --id <row> (--target-tag <tag> | --target-sha <sha>)`** lands ONE
  approved bump: fetches tags, refuses no-op or backward targets (ancestry
  probe + a committer-date belt for shallow grafts,
  `auto-bump.mts:496-550`), checks out the target in the submodule, rewrites
  that row's `pinned_sha`/`pinned_tag` in the OWNING manifest file (root or
  the `includes[]` sub-manifest that physically holds the row,
  `auto-bump.mts:650-663`), regenerates the `.gitmodules`
  `# <name>-<version> sha256:…` annotation via `gen/gitmodules-hash.mts --set`
  — the only annotation path `uses-sha-verify-guard` accepts — and commits
  surgically: `chore(deps): bump <upstream> to <tag>`
  (`auto-bump.mts:455-623`).

The skill owns the judgment half: the per-row test gate and locked-row
approval happen BEFORE `--apply` is called.

## See also

- [`drift-watch.md`](drift-watch.md) — the fleet-wide drift doctrine lockstep
  serves.
- [`conformance-runners.md`](conformance-runners.md) — the runner shape for the
  bespoke case, and for external-spec corpora such as test262 and WPT.
- [`adversarial-self-review.md`](adversarial-self-review.md) — the general
  adversarial loop the port-gap verify pass instantiates.
- [`portable-microarch.md`](portable-microarch.md) — the fleet perf doctrine
  port perf rewrites defer to for target pinning.
- [`no-live-network-in-tests.md`](no-live-network-in-tests.md) — the conformance
  harness copies fixtures locally and hits no network.
- `.claude/hooks/fleet/gitmodules-comment-guard/` — enforces the
  `# name-version` annotations auto-bump regenerates.
- `.claude/hooks/fleet/latest-release-pin-guard/` — blocks setting a
  `.gitmodules` or `version-pin` pin to an older release than the upstream's
  newest tag.
