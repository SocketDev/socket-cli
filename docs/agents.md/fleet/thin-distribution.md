# Thin distribution — fetch the fleet payload, don't git-track it

A fleet member can go **thin**: stop git-tracking the wholly-fleet payload (the
hooks, skills, configs, scripts the cascade copies verbatim) and let the
**fleet release bundle** repopulate it from a pinned GitHub Release. The member's
git history then carries only what it owns, not thousands of mirrored files.

## What's tracked vs untracked

- **Untracked (`.gitignore`d + `git rm --cached`)** — every *wholly-fleet* file
  the bundle copies verbatim: the `fleet/` tiers (`.claude/{hooks,skills,commands,agents}/fleet`,
  `docs/agents.md/fleet`, `.config/fleet`, `scripts/fleet`), the dir-mirror roots,
  root files like `.npmrc`, and the regenerated `.agents/` mirror. These come
  from the download/fetch action, not from git-synced commits.
- **Tracked (stays in git)** — *hybrid* files the cascade MERGES, where the repo
  owns part: `CLAUDE.md` (fleet block + repo postamble), `pnpm-workspace.yaml`
  (fleet sections + repo `packages:`), `package.json`. Plus `bootstrap/fleet.mjs`
  itself — the dep-0 bootstrap. It is the fetcher, so it can't ship inside the
  bundle it fetches: it's EXCLUDED from the release (`releaseExclude` in the
  mirror manifest) and cascaded the OLD way — a manual safe-copy that paves over
  the member's copy + commits it. It stays tracked by living outside the untrack
  set, so a bootstrap change reaches members via a fleet-wave cascade, not the
  belt fetch.

The untrack set is computed by `bootstrap/fleet.mjs --thin` (`thinIgnoreEntries`):
it collapses only to the `fleet/` tier (convention-guaranteed all-fleet) and
lists every other wholly-fleet file EXACTLY — so it can NEVER catch a repo-owned
sibling (`.claude/hooks/repo/`, `.config/repo/`, the member's own
`.github/workflows/ci.yml`).

## The ref pin

A thin member pins which bundle to fetch in its wheelhouse settings file:
`.config/socket-wheelhouse.json` → `"bundle": { "ref": "fleet-<sha>" }`. That
file is the single member-owned config surface. The bootstrap defaults its
`--ref` from there, so the pin lives in exactly one place.

## Belt-and-suspenders fetch

A thin member repopulates its payload BOTH ways — neither alone is enough, so
both are required (and enforced):

- **Belt (dev / clone)** — `package.json` `prepare` starts with
  `node bootstrap/prepare.mts` (`PREPARE_FETCH` in `bootstrap/src/install.mts`),
  which runs `node bootstrap/fleet.mjs --if-current` then reconciles the
  install. A fresh clone / `pnpm install` fetches + applies the pinned bundle
  BEFORE the (itself-untracked) install-git-hooks step + any chained build.
  `--if-current` is idempotent: it skips when the pinned ref is already applied
  — a local marker at `node_modules/.cache/fleet/socket-wheelhouse/bundle-applied` —
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

`checks/thin-consumer-wiring.mts` (`thin_wiring_missing`) fails when a member
that went thin (its `.gitignore` untracks the fleet payload — detected by the
`scripts/fleet/` untrack entry, which every repo has but only a thin one
gitignores) is missing the prepare belt. A non-thin member (it tracks the
payload) is exempt. Run `node bootstrap/fleet.mjs --wire` to add the belt +
`sync-fleet` script. The CI suspenders are enforced by the `ci.yml`-shape check
(workflow-fleet-block), which pins the fleet block that runs the
setup-and-install composite.

## Always tracked: the GitHub surface

Going thin never untracks `.github/workflows/**` or
`.github/actions/fleet/**`. GitHub reads both at rest from the committed tree:
a scheduled workflow registers its cron from the DEFAULT branch's committed
file, and a `uses: ./.github/actions/...` composite must exist at checkout —
before any fetch step could run. Workflow + composite updates therefore always
travel in the cascade COMMIT, never the release bundle. Same for `bootstrap/`
itself (the fetcher can't ship inside the bundle it fetches — `releaseExclude`
in the mirror manifest) and the hybrid-spliced files the repo part-owns.

## Release updates: prune vs tombstones

A bundle update reaches a thin member as a true SYNC, and two different
mechanisms prune what a new release dropped:

- **Wholly-fleet dir roots** (the `fleet/` tiers): after placing the bundle,
  `pruneStaleFleetFiles()` (`bootstrap/src/install.mts`) deletes any on-disk
  file under those roots that the fetched manifest no longer lists. Renames,
  deletions, and additions inside a mirror tree need NO bookkeeping — the
  fetch prunes them, and the cascade's delete-and-replace does the same for
  tracked members.
- **Loose files outside the mirror roots**: these need a `removed[]` tombstone
  in `scripts/repo/sync-scaffolding/manifest/bundle.json`; the cascade fixer
  `safeDelete`s the path in every member.

The LAW joining the two (`fleetMirroredTombstones` in
`scripts/repo/sync-scaffolding/manifest/identical-files.mts`): **never
tombstone a fleet-mirrored path.** A tombstone overlapping an ACTIVE
delete-and-replace mirror root is at best redundant and at worst a
self-destruct — the orphan pass would delete the freshly-copied tree on every
cascade — so the module THROWS at load time on any overlap. A RETIRED mirror
tier (removed from the manifest, e.g. the old cascaded `test/unit/fleet`) is
no longer mirrored and legitimately gets a tombstone; the overlap check is the
sole gate.

## The post-thin cascade commit

The 2026-07-12 thin-cascade scan sized the split: of the ~1,853 files /
~20.6 MB a tracked member mirrors today, ~1,700 can leave version control;
the tracked residue is the GitHub surface, the hybrids, the fetcher, a small
Claude session kernel, and a few at-rest pin files. A steady-state wave then
lands in each member as a commit touching **1-3 files**:

- the ref pin bump — `bundle.ref` + `bundle.cascadeSha` in
  `.config/socket-wheelhouse.json` (always),
- hybrid files, IF their fleet blocks changed,
- tracked kernel / workflow / composite files, IF they changed.

Everything else arrives via the belt fetch on the next `pnpm install`.

## Commands

- `node bootstrap/fleet.mjs --ref fleet-<sha> --thin --wire` — convert a repo to
  thin: fetch + apply, untrack the payload, write the belt.
- `node bootstrap/fleet.mjs --if-current` — the belt/CI fetch (idempotent, ref
  from settings).
- `pnpm run sync-fleet` — manual full re-fetch.
