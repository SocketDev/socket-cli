# Version bumps

Companion to the `### Version bumps` rule in `template/base/CLAUDE.md`. The inline section gives the headline. This file is the ordered sequence, the CHANGELOG filter, and the rationale.

## The version number is the user's call, never the agent's

The USER names the target version (`vX.Y.Z`) or the release level
(patch/minor/major). An agent never invents or derives that decision on its
own — `bump.mts --dry-run` is always open (it only prints the evidence), but
a WRITE run needs the user's naming first. `bump-defers-to-release-guard`
(PreToolUse) blocks a non-dry-run `bump.mts` invocation and a bare
`npm|pnpm|yarn version <arg>` write, and requires `Allow release-bump bypass`
after the version has been named; a major bump additionally requires
`Allow major-bump bypass`. In CI, major happens only when a human manually
selects it on the release workflow's dispatch form — `bump.mts` itself never
derives major from commit types.

## The sequence (order matters)

When the user asks for a version bump (`bump to vX.Y.Z`, `tag X.Y.Z`,
`release X`, etc.), follow this exactly. Skipping or reordering produces
broken releases.

### 1. Pre-bump prep wave

Each command must finish clean before the next runs:

```bash
pnpm run update      # dependency drift
pnpm i               # lockfile alignment
pnpm run fix --all   # formatting + autofix-able lint
pnpm run check --all # type + lint + path gates
pnpm run cover       # tests pass AND the coverage threshold holds
```

`pnpm run cover` is part of the wave, not optional: it runs the suite under
coverage and fails if a test fails or coverage drops below the repo's
threshold. It also emits
`.cache/fleet/coverage/coverage-summary.json` (the `json-summary`
reporter). After it passes, refresh the README coverage badge from that summary
and commit the refresh:

```bash
node scripts/fleet/gen/coverage-badge.mts
```

The badge is generated from the coverage run, so it drifts whenever coverage
moves. `coverage-badge-is-current` (in `check --all`) fails the gate when the
README badge disagrees with the coverage data, and `version-bump-order-guard`
refuses the bump commit unless `coverage-summary.json` is newer than the latest
`src/` change — proof `cover` ran on the code being released, not a stale run.

If any step surfaces failures, fix them before continuing. Don't bump
a broken tree.

Then run the change through [agent-ci.dev](https://agent-ci.dev) (the
`agent-ci` skill), the fleet's pre-merge agent CI. The bump proceeds only
once agent-ci passes; until then there is no bump commit and no tag.

### 2. CHANGELOG entry: public-facing only

The new `## [X.Y.Z]` block describes what a downstream consumer needs
to know to upgrade.

**Include:**

- New exports
- Removed exports
- Renamed exports
- Signature changes
- Behavioral changes
- Perf characteristics they will measure
- Migration recipes

**Exclude:**

- Internal refactors
- File moves
- Test reorg
- Primordials cleanup
- Lint passes
- `chore(wheelhouse)` cascades
- Build-script tweaks

Use [Keep-a-Changelog](https://keepachangelog.com/) sections (Added /
Changed / Removed / Renamed / Fixed / Performance / Migration).

**No empty sections.** If the public-facing-only filter leaves a section
with zero bullets, delete the heading too — don't leave `### Changed`
followed by a blank line and the next heading. A reader scanning the
release for "what changed" should not have to disambiguate "section
intentionally empty" from "section forgot its content." Enforced
pre-commit by `.claude/hooks/fleet/changelog-no-empty-guard/`;
bypass `Allow changelog-empty-section bypass`.

Source the raw list with `git log <prev-tag>..HEAD --pretty="%s"` and
filter to consumer-visible commits only.

### 3. The bump commit is the LAST commit on the release

If a session has other unrelated work to commit, those land first; the
`chore: bump version to X.Y.Z` commit (carrying both `package.json` and
`CHANGELOG.md`) is the tip of the branch when tagging.

If a version-bump commit already exists earlier in history, rebase it
forward so it ends up at the tip.

The bump commit must sit on a **green tree**. `version-bump-order-guard`
runs the fast pre-release gate (`pnpm run lint --all` + `pnpm audit`) when
it sees a `git commit -m "chore: bump version to X.Y.Z"`, and blocks the
commit if either fails. The gate runs at the commit as well as the tag, so
a bump cannot land atop accumulated lint debt that CI then rejects on push
— a bump once shipped over 100+ lint errors and failed CI after the commit.
To skip the gate but keep the ordering check, set
`SOCKET_VERSION_BUMP_SKIP_GATE=1`; to bypass the whole guard, type
`Allow version-bump-order bypass`.

### 4. Tag + GitHub release come LAST — after the registry publish

Never create or push `vX.Y.Z` before the version is live on its registry.
The tag + immutable GH release are the FINAL markers of a release: a STAGED
npm package is not published (staging may never be approved), and a release
cut early can mark a version that never shipped — an immutable release even
422-rejects its own late asset uploads. The approve flow owns them:
`publish-pipeline.mts --approve` (or `npm-publish.mts --approve` /
`cargo-publish.mts --approve` out-of-band) promotes, waits for the registry
to resolve the version (`requireRegistryLive`), then tags + cuts the release
at the bump commit. The `version-bump-order-guard` hook enforces the
bump-before-tag ordering at commit time; the github-release workflow refuses
to cut for a version the registry can't resolve.

### 5. Publish through the pipeline — never by hand, never a raw dispatch

The pipeline is the ONE sanctioned publisher. Its stage-publish leg
dispatches the `npm-publish.yml` workflow itself and watches the run, so the
staged upload happens in CI under OIDC — no local npm login, no local OTP.
`publish-pipeline.mts --local` is the explicit offline escape for humans.
Agents must not publish locally (`npm publish`, `pnpm stage publish`,
`cargo publish`, a direct `npm-publish.mts` run — blocked by
`verify-before-publish-guard`) and must not hand-dispatch publish workflows
(`gh workflow run` — blocked by `release-workflow-guard`). The human-owned
step remains `publish-pipeline.mts --approve`: the 2FA promote, then the
tag + immutable GH release cut LAST behind registry liveness.

## A version bump NEVER travels through a pull request

The bump commit lands **directly on the default branch**. Locally that is what
the release pipeline's bump stage already does; in CI the release App commits
the bumped `package.json` + `CHANGELOG.md` through the GitHub git-objects API
and then fast-forwards the default branch to that exact commit
(`promoteReleaseBranch` in `scripts/fleet/publish-infra/release-branch.mts`).

Opening a PR for the bump is a defect, not a workflow. A PR needs branch
protection to be satisfied before anything merges, so the bump sits behind
review requirements, status checks, and an auto-merge queue that a
freshly-created branch cannot satisfy — `enablePullRequestAutoMerge` fails with
`Pull request Branch does not have required protected branch rules`, the run
dies, and the publish never happens. The version is already decided by the
committed hint and the content is machine-generated, so there is nothing for a
reviewer to approve.

`no-version-bump-pr-guard` blocks the shape at the source. It refuses any
command that opens a PR whose head branch is bump-shaped
(`npm-publish-v1.2.3`, `release-v1.2.3`, `bump-1.2.3`, anything carrying
`version-bump`) or whose title is bump-shaped (`chore: bump version to 1.2.3`,
`chore(release): 1.2.3`, any `bump version` phrasing) — `gh pr create` in every
flag spelling, `gh api …/pulls`, and a raw REST `POST /repos/*/pulls`. A normal
feature PR (`feat/foo`, `fix: thing`) is untouched. Bypass with
`Allow version-bump-pr bypass`.

The release App holds `contents: write` and is on the default branch's
push-bypass allowlist, so the fast-forward needs no PR and no human hand-land.

## The bump base is the last PUBLISHED version, never the manifest

`bump.mts` (and the cargo bump) compute the next version from `resolveBumpBase`
— the max of the registry's `dist-tags.latest` and the last `vX.Y.Z` tag —
NEVER from `package.json`/`Cargo.toml`. A manifest can sit ahead of what
actually published — a hand pre-bump, or a stale `X.Y.Z-prerelease` hint — and
bumping off an ahead manifest silently SKIPS a version: package.json was
pre-bumped to 1.4.3, then the release bumped 1.4.3 → 1.4.4, so 1.4.3 was never
published. A `-prerelease` hint that names an already-published (or lower)
version fails loud rather than re-publishing.

The `version-is-not-ahead-of-published` check is the release-tier gate: it fails
when the manifest is more than one valid bump ahead of the published latest, and
fails open (no published version / registry unreachable) so offline lint lanes
never trip it.

## A placeholder version releases 0.1.0 first

A package that has never shipped still carries the placeholder version its
scaffolding wrote: `0.0.0`, or a `X.Y.Z-prerelease` such as the
`0.1.0-prerelease` an envrypt-shaped workspace keeps in its root `Cargo.toml`
`[workspace.package]`. Its first real release is **`0.1.0`** — not a
commit-derived bump, and not `1.0.0`. `@socketsecurity/facts` sat at `0.0.0`
and shipped `0.1.0`; `@socketsecurity/scan-patterns` follows the same path.

The commit-type heuristic cannot answer in that state. With no released base,
the whole history is in range, so a single `feat!` asks for a major, an
all-`fix` stream asks for `0.0.1`, and an all-`chore` stream asks for nothing
at all — three wrong answers for one first cut.

`decidePlaceholderRelease` in `scripts/fleet/bump/placeholder-release.mts` owns
the decision. It is pure over three facts `bump.mts` collects: whether the
release anchor resolved a prior release, the CHANGELOG's existing version
sections, and the version-source manifest version. All three must say "nothing
shipped" before the default applies, so a repo with real history is never
mistaken for a fresh one.

What the operator sees:

| State | Default | Output |
| --- | --- | --- |
| Placeholder, no `--release-as` | `0.1.0` | The detected state, why `0.1.0`, and that `--release-as` overrides |
| Placeholder, `--release-as <level\|X.Y.Z>` | the named version | The named version is honored over the `0.1.0` default |
| Placeholder, named version below `0.1.0` | the named version | A loud warning that a placeholder conventionally starts at `0.1.0`, then it proceeds |
| Already released | unchanged | Nothing — the commit-derived path is untouched |

The version stays the OWNER's decision: this moves the DEFAULT only. An
explicit `--release-as` always wins, a sub-`0.1.0` choice warns but never
blocks, and `--dry-run` prints the identical reasoning before anything is
written. In placeholder state a level counts up from zero, so
`--release-as minor` lands `0.1.0` rather than skipping past the `0.1.0` a
`0.1.0-prerelease` manifest never shipped.

## The bump happens exactly once

`bump.mts` owns the version write, and the whole pipeline + workflow chain
runs it exactly once. Two guards enforce that:

- the publish pipeline's stage-publish leg dispatches `npm-publish.yml` with
  `bump: false` — its own bump stage already landed the bump commit, so the
  workflow's CI bump step is skipped. Manual dispatches keep the default
  `bump: true` hint-consuming flow; `remote:npm:publish --no-bump` is the
  manual opt-out.
- `bump.mts` is idempotent per version: when `CHANGELOG.md` already carries
  the section for the computed next version and `package.json` already reads
  it, the run is a loud no-op. A re-entrant CI bump once re-derived the same
  6.2.1 and committed a DUPLICATE changelog section via the release App;
  `insertChangelogSection` now refuses to insert a section for a version the
  changelog already has.

## The changelog range anchors to the released version, never an older tag

`deriveReleaseCommits` in `bump.mts` is the ONE derivation both the bump and
the `changelog-is-commit-derived` check run — same base, same anchor, same
commit stream — so generation and verification cannot disagree. Its range
anchor resolves through a strict chain: the previous release's own
`v<version>` tag when it exists on HEAD's lineage; else the commit that
flipped `package.json` to that version — the release's bump commit; else the
registry's publish timestamp for that version as a `--since` bound. A
previous release no link can anchor stops the bump loud, and the drift check
skips. The chain never falls back to an OLDER tag: socket-lib 6.2.2's
generated section re-listed the already-shipped 6.2.1 fix because the missing
v6.2.1 tag silently widened the range to v6.2.0.

## Hand-written notes accrue under [Unreleased]; the bump promotes them

Derivation only sees typed commits: feat / fix / perf / revert reach the
CHANGELOG; chore / style / test / docs / ci / build / refactor never do. Work
that ships under an invisible type still needs documenting — write its bullets
by hand under `## [Unreleased]` as the work lands. That section is the ONE
home for hand-written release notes; hand-editing a version section directly
is still drift.

At bump time `composeReleaseSection` in `bump.mts` builds the release section
from BOTH sources: the commit-derived bullets unioned with the hand-written
`[Unreleased]` bullets, merged under their matching Added / Changed / Fixed
headings, exact-duplicate lines collapsed. Promotion then empties the
`[Unreleased]` block — the fleet style creates the heading on demand, so
squash-time accrual recreates it when the next entry lands.

`changelog-is-commit-derived` verifies the derived side only: every
commit-derived bullet must be PRESENT in the pending section, and the
anchor/range must be correct. Hand-written extras are tolerated — hand content
is human-owned — and a present `[Unreleased]` section is never a finding.
Losing derived content stays red.

The safety net is a bump-time WARNING, never a red: commits since the anchor
that touch `src/` but are typed chore / style / test are invisible to
derivation, so the bump names them and asks you to add `[Unreleased]` bullets
or retype the commits if they carry user-facing work. The same text lands in
the CI job summary when the bump runs there. It cannot fail the bump — a
chore commit touching `src/` is often genuinely internal, and over-absolute
rules get enforced and block real work.

WHY: sdk 4.0.2 shipped its cached-scan/pollIntervalMs feature UNDOCUMENTED.
The feature's bullets were hand-written under `[Unreleased]`, its commits were
chore-typed, and the then-strict commit-derived regeneration dropped the hand
side at bump time. The union rule, the superset-tolerant check, and the
warning close that hole from three directions.

## Verify is auth-honest, and approve reconciles from registry truth

`pnpm stage list` 401s without npm auth and its failure output parses as an
EMPTY list. The verify stage treats that as auth unavailable — a `blocked`
receipt carrying the `npm whoami` evidence — never as a failed verify with
"0 staged entries"; the 6.2.1 run recorded exactly that false negative and
stranded the pipeline with no path to the tag + GH release. When the target
version is ALREADY live on the registry, verify and `--approve` recover from
registry truth instead: re-pack at the bump commit, compare against the
packument `dist` digests with the extracted-contents fallback, mint the
verify + approve receipts from that evidence, and continue into the normal
release stage — so the tag + immutable GH release still cut behind the
confirmed publish. Divergent bytes refuse loudly; registry truth is
evidence, never a rubber stamp.

## Backfill: republish a skipped GAP version

WHY: a version can end up skipped — 1.4.3 between a live 1.4.2 and 1.4.4 —
and the normal path can't fill it: the bump gate anchors to registry latest
and refuses anything at-or-below it, and a historical branch can't be
dispatched because `workflow_dispatch` needs `npm-publish.yml` on the
dispatched ref. Backfill is the sanctioned gap-fill: dispatch
`npm-publish.yml` from MAIN — the workflow definition always exists there —
with `backfill-version` naming the gap and `checkout-ref` naming the content
commit. The bump/changelog gate is bypassed; hard guards in
`scripts/fleet/publish-infra/npm/backfill.mts` replace it, each refusing
loud:

1. the version is absent from the registry `time` map — never published,
   never published-then-unpublished; an unreadable map fails closed;
2. the version is LOWER than registry latest — gap-fill only, never a
   forward bump-gate bypass;
3. the dist-tag is explicitly non-`latest` — the latest pointer never moves;
4. `checkout-ref` is set — the content ref is never implied;
5. the checked-out `package.json` version equals `backfill-version` — the
   content commit declares itself.

The publish then runs the normal staged path: stage in CI, verify + promote
with the usual local `--approve`. Approve from a checkout of the SAME
content ref, with `--no-reconcile`: the pre-approve integrity gate packs the
local tree and refuses a mismatch, and the post-approve reconcile assumes a
tip-of-main release, which a backfill is not.

## Why this order

- **Bisecting from `main` past the tag must not land on a
  temporarily-broken state.** If the bump commit is the tip,
  `git bisect` between any prior commit and the tag passes through
  only known-good states.
- **`git describe` is cleaner when the bump is the tip.** `vX.Y.Z`
  matches `git describe --tags --exact-match HEAD` exactly at release
  time; downstream tooling that uses `git describe` for version
  detection sees clean output.
- **The pre-bump prep wave catches drift consumers would hit on first install.** Dependency drift, formatting drift, type drift; the fleet check passes on your branch but breaks on a clean clone if these aren't run before tagging.
- **The public-facing-only filter is the difference between a
  changelog people read and a changelog people skip.** A 200-line
  block of `chore(wheelhouse)` entries trains downstream consumers to ignore
  CHANGELOG.md entirely.

## See also

- `.claude/hooks/fleet/version-bump-order-guard/`: enforces the bump-at-tip + tag-after-bump ordering.
- `.claude/hooks/fleet/bump-defers-to-release-guard/`: blocks an agent-driven version bump ahead of the user naming it.
- `.claude/hooks/fleet/release-workflow-guard/`: blocks `gh workflow run` dispatches that aren't dry-run.
- `.claude/hooks/fleet/immutable-release-guard/`: blocks the single-call `gh release create <tag> <files>` shape in a workflow file.
- `.claude/hooks/fleet/release-tag-tied-guard/`: allows `gh release create <ref>` only when `<ref>` is an existing pushed/local tag with no `--target`, so a release can never mint an arbitrary, unreviewed tag on the fly.
- `scripts/fleet/check/version-is-not-ahead-of-published.mts`: release-tier gate that fails when package.json is bumped more than one release past the published latest (the skip-risk state).
- [`immutable-releases.md`](immutable-releases.md): every GitHub Release that lands as a result of this sequence ships immutable (Sigstore release attestation, asset lock, tag protection). The release workflow MUST use the 3-step draft → upload → publish pattern; single-call `gh release create <tag> <files>` is forbidden.
