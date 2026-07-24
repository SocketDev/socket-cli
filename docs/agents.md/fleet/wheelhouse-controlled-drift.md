# Wheelhouse-controlled files must never drift from `template/base`

A **wheelhouse-controlled** file is one the wheelhouse owns byte-for-byte and
distributes to every fleet member. There are two distribution channels, and both
read the SAME canonical source (`template/base/…`):

1. **The GitHub-Release bundle** — `scripts/repo/make-release-bundle.mts`
   collects the byte-canonical mirror (`IDENTICAL_FILES`, from
   `manifest/bundle.json`'s `mirror[]`) plus every present
   `OPTIONAL_IDENTICAL_FILES` entry, hashes each, and ships the tarball a member
   fetches with the dep-0 bootstrap.
2. **The commit cascade** — `scripts/repo/sync-scaffolding` mirrors the same set
   into each member's working tree (delete-and-replace for dir entries, byte-copy
   for file entries), resolving `base` + `kind` (`solo`/`mono`) +
   `overrides/<repo>` per member.

Because both channels derive from `template/base`, the ONLY correct place to
change a wheelhouse-controlled file is `template/base/<path>` — then re-cascade.
Editing the root copy directly is drift: the next cascade either overwrites your
edit (best case) or the wheelhouse ships a root copy that silently disagrees with
`template/base` (the incident this rule exists to stop — release workflows
`github-release.yml` + `npm-publish.yml` sat as seeded PRESETs whose stale root
copies drifted from the canonical content for weeks because NO check walked
`template/base` to assert every file was classified into a channel).

## Why drift is a bug

A wheelhouse-controlled file that drifts breaks the fleet's single-source-of-truth
guarantee:

- The release bundle and the cascade can ship DIFFERENT bytes for the same path.
- A member's root copy stops matching what the wheelhouse believes it distributes.
- The drift is invisible until a downstream CI break traces back to it.

## How a file is classified

Every file under `template/base/` MUST be reachable by exactly one channel:

- **`IDENTICAL_FILES` (mirror)** — byte-canonical everywhere; file entries and
  delete-and-replace dir entries in `manifest/bundle.json` `mirror[]`.
- **`OPTIONAL_IDENTICAL_FILES`** — byte-canonical *when present*; missing is fine
  (opt-in per member).
- **`PRESET_FILES`** — seeded once from `template/presets/` (sources live there,
  not in `template/base`), then repo-owned.
- **`CONDITIONAL_FILES`** — required when a marker / capability / build-type holds.
- **`EXPECTED_FILES`** — must exist but content varies per repo (`package.json`,
  `CLAUDE.md`, `.gitignore`, …).
- **A carve-out / kind layer / `overrides/<repo>` layer** — the `repo/` tiers and
  per-repo divergences (e.g. the template source's own bundle-cutter
  `github-release.yml` in its per-repo overrides tier).
- **A native handler** — a per-file cascade handler outside the manifest byte
  lists: `.claude/settings.json` (merge-aware `settings-merge`), `README.md`
  (`readme-skeleton-drift`, per-repo content), and `.github/aw/actions-lock.json`
  — the gh-aw `gh aw compile` companion, generated + committed per repo.

An unclassified `template/base` file is a defect — it reaches no member and no
release bundle, so it is authored-but-undistributed.

## How to fix drift

1. Edit the canonical file at `template/base/<path>` (never the root copy).
2. Re-cascade: `node scripts/repo/sync.mts <target…>` (or the dogfood self-sync
   `node scripts/repo/sync-scaffolding/cli.mts --target . --fix`).
3. If a file is genuinely wheelhouse-controlled but classified into no channel,
   add it to the right manifest list (mirror for byte-canonical, optional for
   opt-in) — the same promotion the release-workflow fix applied.

## Enforcement

- `scripts/fleet/check/wheelhouse-controlled-files-are-classified.mts` — the belt
  scan. Assertion A (blocking) walks `template/base` and fails when any file is
  unclassified. Assertion B (report-only for now) reports a present root copy that
  has drifted from its resolved template source.
- `.claude/hooks/fleet/wheelhouse-drift-guard/` — the write-time twin. Blocks an
  Edit/MultiEdit/Write to a root copy of a byte-controlled path that WOULD drift
  from the resolved template, pointing at `template/base` + the re-cascade.
  Bypass: `Allow wheelhouse-drift bypass`.
