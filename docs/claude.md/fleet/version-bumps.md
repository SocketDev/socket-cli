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
```

If any step surfaces failures, fix them before continuing. Don't bump
a broken tree.

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

### 4. Tag at the end

`git tag vX.Y.Z` at the bump commit, then push the tag. The
`version-bump-order-guard` hook enforces this ordering at commit time.

### 5. Do NOT dispatch the publish workflow

Per the [Public-surface hygiene](#public-surface-hygiene) rule (in
CLAUDE.md), releases are user-triggered. Stop after the tag push;
the user runs the publish workflow manually.

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
- [`immutable-releases.md`](immutable-releases.md): every GitHub Release that lands as a result of this sequence ships immutable (Sigstore release attestation, asset lock, tag protection). The release workflow MUST use the 3-step draft → upload → publish pattern; single-call `gh release create <tag> <files>` is forbidden.
