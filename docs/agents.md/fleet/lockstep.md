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

- **Location.** `resolveManifestRoot` (`scripts/fleet/lockstep/manifest.mts:61-67`)
  reads `<repo-root>/lockstep.json` when present, else
  `.config/lockstep.json`. The cascade seeds `.config/lockstep.json` as
  per-repo content — rows differ per repo
  (`scripts/repo/sync-scaffolding/manifest/files.mts`, `EXPECTED_FILES`
  comment). Empty `rows: []` is valid for repos with no upstream ties.
- **Schema.** `scripts/fleet/lockstep/schema.mts` is the TypeBox single source
  of truth; everything derives from it: TS types via `Static<typeof …>`, the
  editor-facing `.config/lockstep.schema.json` (emitted by
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
  `git submodule update`", `checks.mts:153-159`). Drift = commit count from
  the pin to the fetched `origin/HEAD|main|master` ref (`checks.mts:161-207`);
  with no remote ref the row stays ok with a can't-compute note.
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
  `# <name>-<version> sha256:…` annotation via `gen-gitmodules-hash.mts --set`
  (the only annotation path `uses-sha-verify-guard` accepts), and commits
  surgically: `chore(deps): bump <upstream> to <tag>`
  (`auto-bump.mts:455-623`).

The skill owns the judgment half: the per-row test gate and locked-row
approval happen BEFORE `--apply` is called.

## See also

- [`drift-watch.md`](drift-watch.md) — the fleet-wide drift doctrine lockstep
  serves.
- `.claude/hooks/fleet/gitmodules-comment-guard/` — enforces the
  `# name-version` annotations auto-bump regenerates.
