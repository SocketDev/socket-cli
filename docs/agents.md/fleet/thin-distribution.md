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
`.config/fleet.json` → `"bundle": { "ref": "fleet-<sha>" }`. That
file is the single member-owned config surface. The bootstrap defaults its
`--ref` from there, so the pin lives in exactly one place.

## Belt-and-suspenders fetch

A thin member repopulates its payload BOTH ways — neither alone is enough, so
both are required (and enforced):

- **Belt (dev / clone)** — `package.json` `prepare` starts with
  `node bootstrap/fleet.mjs --if-current`. A fresh clone / `pnpm install`
  fetches + applies the pinned bundle BEFORE the (itself-untracked)
  install-git-hooks step + any chained build. `--if-current` is idempotent: it
  skips when the pinned ref is already applied (a local, gitignored
  `.config/fleet/.bundle-applied` marker), so warm installs do no network, and it
  no-ops in a non-thin repo (nothing pinned → nothing to fetch).
- **Suspenders (CI)** — the canonical `ci.yml` delegates to socket-registry's
  shared reusable, whose `setup-and-install` composite runs the same fetch after
  checkout, before lint/test. CI never runs against a missing payload.

## Enforcement (code-is-law)

`checks/thin-consumer-wiring.mts` (`thin_wiring_missing`) fails when a member
that went thin (its `.gitignore` untracks the fleet payload — detected by the
`scripts/fleet/` untrack entry, which every repo has but only a thin one
gitignores) is missing the prepare belt. A non-thin member (it tracks the
payload) is exempt. Run `node bootstrap/fleet.mjs --wire` to add the belt +
`sync-fleet` script. The CI suspenders are enforced by the `ci.yml`-shape check
(workflow-fleet-block) plus socket-registry's own CI on the shared composite.

## Commands

- `node bootstrap/fleet.mjs --ref fleet-<sha> --thin --wire` — convert a repo to
  thin: fetch + apply, untrack the payload, write the belt.
- `node bootstrap/fleet.mjs --if-current` — the belt/CI fetch (idempotent, ref
  from settings).
- `pnpm run sync-fleet` — manual full re-fetch.
