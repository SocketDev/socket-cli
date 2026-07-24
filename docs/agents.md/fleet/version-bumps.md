# Version bumps

Companion to the `### Version bumps` rule in `template/CLAUDE.md`. The inline section gives the headline. This file is the ordered sequence, the CHANGELOG filter, and the rationale.

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
`node_modules/.cache/fleet/coverage/coverage-summary.json` (the `json-summary`
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
- `.claude/hooks/fleet/release-workflow-guard/`: blocks `gh workflow run` dispatches that aren't dry-run.
- `scripts/fleet/check/version-is-not-ahead-of-published.mts`: release-tier gate that fails when package.json is bumped more than one release past the published latest (the skip-risk state).
- [`immutable-releases.md`](immutable-releases.md): every GitHub Release that lands as a result of this sequence ships immutable (Sigstore release attestation, asset lock, tag protection). The release workflow MUST use the 3-step draft → upload → publish pattern; single-call `gh release create <tag> <files>` is forbidden.
