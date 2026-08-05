# Thin distribution — fetch the fleet payload, don't git-track it

Every fleet member is **thin**: it does not git-track the wholly-fleet payload,
meaning the hooks, skills, configs, and scripts the cascade copies verbatim, and the
**fleet release bundle** repopulates that payload from a pinned GitHub Release.
A member's git history then carries only what it owns, not thousands of mirrored
files. The wheelhouse is the one exception, because it produces the bundle and
so has to hold the payload it ships.

## What's tracked vs untracked

- **Untracked (`.gitignore`d + `git rm --cached`)** — every *wholly-fleet* file
  the bundle copies verbatim: the `fleet/` tiers (`.claude/{hooks,skills,commands,agents}/fleet`,
  `docs/agents.md/fleet`, `.config/fleet`, `scripts/fleet`), the dir-mirror roots,
  root files like `.npmrc`, and the regenerated `.agents/` mirror. These come
  from the download/fetch action, not from git-synced commits.
- **Tracked (stays in git)** — *hybrid* files the cascade MERGES, where the repo
  owns part: `CLAUDE.md` (fleet block + repo postamble), `pnpm-workspace.yaml`
  (fleet sections + repo `packages:`), `package.json`. Plus `scripts/repo/bootstrap/fleet.mjs`
  itself — the dep-0 bootstrap. It is the fetcher, so it can't ship inside the
  bundle it fetches: it's EXCLUDED from the release (`releaseExclude` in the
  mirror manifest) and cascaded the OLD way — a manual safe-copy that paves over
  the member's copy + commits it. It stays tracked by living outside the untrack
  set, so a bootstrap change reaches members via a fleet-wave cascade, not the
  belt fetch.

The untrack set is computed by `scripts/repo/bootstrap/fleet.mjs --thin` (`thinIgnoreEntries`):
it collapses only to the `fleet/` tier (convention-guaranteed all-fleet) and
lists every other wholly-fleet file EXACTLY — so it can NEVER catch a repo-owned
sibling (`.claude/hooks/repo/**`, `.config/repo/`, the member's own
`.github/workflows/ci.yml`).

## The ref pin

A thin member pins which bundle to fetch in its wheelhouse settings file:
`.config/repo/socket-wheelhouse.json` → `"bundle": { "ref": "fleet-pack-<sha>" }`. That
file is the single member-owned config surface. The bootstrap defaults its
`--ref` from there, so the pin lives in exactly one place.

## Belt-and-suspenders fetch

A thin member repopulates its payload BOTH ways — neither alone is enough, so
both are required (and enforced):

- **Belt (dev / clone)** — `package.json` `prepare` starts with
  `node scripts/repo/bootstrap/prepare.mts` (`PREPARE_FETCH` in
  `scripts/repo/gen/bootstrap/src/install.mts`),
  which runs `node scripts/repo/bootstrap/fleet.mjs --if-current` then reconciles the
  install. A fresh clone / `pnpm install` fetches + applies the pinned bundle
  BEFORE the (itself-untracked) install-git-hooks step + any chained build.
  `--if-current` is idempotent: it skips when the pinned ref is already applied
  — a local marker at `.cache/fleet/socket-wheelhouse/bundle-applied` —
  so warm installs do no network, and it no-ops in a non-thin repo (nothing
  pinned → nothing to fetch).
- **Suspenders (CI)** — the same belt, exercised by CI's install step: the
  checked-in `ci.yml` runs the local `./.github/actions/fleet/setup-and-install`
  composite, whose install step runs `pnpm install` — lifecycle scripts
  included, so `prepare` fires the identical `--if-current` fetch after
  checkout, before lint/test. CI never runs against a missing payload. (The
  fetch shells `gh release download` against the private wheelhouse, so the CI
  job needs a token that can read wheelhouse releases in `GH_TOKEN`.)

## Enforcement (code-is-law)

Thin is not an opt-in: EVERY roster member is a thin consumer. The canonical
roster (`.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`) is the
single source of truth for membership, and `isThinMember` (in the shared
`fleet-roster.mts`) derives thin-ness from it — a repo is thin exactly when it
is on the roster. Two shapes fall outside by identity, never by configuration:
a checkout absent from the roster, and the wheelhouse itself, which produces
the bundle and is never its consumer.

`scripts/repo/sync-scaffolding/checks/thin-consumer-wiring.mts` (`thin_wiring_missing`) fails when a member
is missing the prepare belt — its fresh clones / CI
would otherwise run against a missing payload. Run
`node scripts/repo/bootstrap/fleet.mjs --wire` to add the belt + `sync-fleet`
script. The CI suspenders are enforced by the `ci.yml`-shape check
(workflow-fleet-block), which pins the fleet block that runs the
setup-and-install composite.

## Always tracked: the GitHub surface

Going thin never untracks `.github/workflows/**` or
`.github/actions/fleet/**`. GitHub reads both at rest from the committed tree:
a scheduled workflow registers its cron from the DEFAULT branch's committed
file, and a `uses: ./.github/actions/...` composite must exist at checkout —
before any fetch step could run. Workflow + composite updates therefore always
travel in the cascade COMMIT, never the release bundle. Same for `scripts/repo/bootstrap/`
itself (the fetcher can't ship inside the bundle it fetches — `releaseExclude`
in the mirror manifest) and the hybrid-spliced files the repo part-owns.

## Release updates: prune vs tombstones

A bundle update reaches a thin member as a true SYNC, and two different
mechanisms prune what a new release dropped:

<details>
<summary><b>The two pruning mechanisms</b> — the per-workspace applied-files record and the blind spots it has, plus the durable tombstone list both installers delete after placement</summary>

- **The applied-files record**: after placing the bundle,
  `pruneStaleFleetFiles()` (`scripts/repo/gen/bootstrap/src/install.mts`) deletes any file the
  LAST-applied manifest owned (the `applied-files` record under
  `.cache/`) that the fetched manifest no longer lists. Renames,
  deletions, and additions inside a mirror tree need NO bookkeeping — but the
  record is per-workspace state: a fresh clone, a CI checkout, or a member
  whose record began after a move prunes nothing (the v1.0.12
  `lib` → `_shared` move under `.github/actions/fleet/` orphaned `lib/` fleet-wide
  exactly this way).
- **Tombstones** (`removed[]` in
  `scripts/repo/sync-scaffolding/manifest/bundle.json`): the durable deletion
  record. The cascade fixer `safeDelete`s each path in every member, AND
  `make-release-bundle` ships the same list in the bundle manifest as
  `removedPaths`, which both installers (`scripts/repo/gen/bootstrap/src/install.mts`
  `removeTombstonedPaths()` + `scripts/fleet/fetch-fleet-pack.mts`) delete
  after placement — so a moved/retired path heals on the next refresh even
  with no applied-files record. A move must ship its deletion: retire a path,
  add its tombstone in the same change. Belt on both legs: a tombstone the
  current bundle ships a file at/under is skipped, never applied.

</details>

The LAW joining the two (`fleetMirroredTombstones` in
`scripts/repo/sync-scaffolding/manifest/identical-files.mts`): **never
tombstone a fleet-mirrored path.** A tombstone overlapping an ACTIVE
delete-and-replace mirror root is at best redundant and at worst a
self-destruct — the orphan pass would delete the freshly-copied tree on every
cascade — so the module THROWS at load time on any overlap. A RETIRED mirror
tier (removed from the manifest, e.g. the old cascaded `test/unit/fleet/**` tree) is
no longer mirrored and legitimately gets a tombstone; the overlap check is the
sole gate.

## The post-thin cascade commit

The 2026-07-12 thin-cascade scan sized the split: of the ~1,853 files /
~20.6 MB a tracked member mirrors today, ~1,700 can leave version control;
the tracked residue is the GitHub surface, the hybrids, the fetcher, a small
Claude session kernel, and a few at-rest pin files. A steady-state wave then
lands in each member as a commit touching **1-3 files**:

- the ref pin bump — `bundle.ref` + `bundle.cascadeSha` in
  `.config/repo/socket-wheelhouse.json` (always),
- hybrid files, IF their fleet blocks changed,
- tracked kernel / workflow / composite files, IF they changed.

Everything else arrives via the belt fetch on the next `pnpm install`.

## Commands

- `node scripts/repo/bootstrap/fleet.mjs --ref fleet-pack-<sha> --thin --wire` — convert a repo to
  thin: fetch + apply, untrack the payload, write the belt.
- `node scripts/repo/bootstrap/fleet.mjs --if-current` — the belt/CI fetch (idempotent, ref
  from settings).
- `pnpm run sync-fleet` — manual full re-fetch.
