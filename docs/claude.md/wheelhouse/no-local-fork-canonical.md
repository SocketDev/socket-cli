# Never fork fleet-canonical files locally

Fleet-canonical files (anything tracked by `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts`) MUST be edited in `socket-wheelhouse/template/...` and cascaded out — never branched locally in a downstream fleet repo.

## Canonical surfaces

These directories and files cascade fleet-wide. They are **not** repo-local:

- `.config/oxlint-plugin/` — plugin index + rules
- `.git-hooks/` — commit-msg / pre-commit / pre-push entry shims + .mts helpers (git invokes the shims when `core.hooksPath` is set to this directory; wired by `scripts/install-git-hooks.mts` at `pnpm install` time)
- `.claude/hooks/` — PreToolUse / PostToolUse hooks
- `.claude/skills/_shared/` — shared skill helpers
- `CLAUDE.md` fleet block (between `BEGIN/END FLEET-CANONICAL` markers)
- `docs/claude.md/fleet/` — fleet-canonical CLAUDE.md offshoot references (applies to every socket-\* repo)
- `docs/claude.md/wheelhouse/` — docs about the wheelhouse cascade mechanism itself (this file lives here)
- Downstream repos may add their own `docs/claude.md/<repo>/` subdirectory for repo-specific docs — those are NOT fleet-canonical.
- Anything else listed in the sync manifest

If unsure, check `socket-wheelhouse/scripts/sync-scaffolding/manifest.mts`. Tracked = canonical.

## How to apply

If a downstream repo needs a behavior change in one of these files:

1. Edit the file in `socket-wheelhouse/template/...`.
2. Commit the template change.
3. Run `node scripts/sync-scaffolding/cli.mts --target <downstream-repo> --fix` to cascade.

Do NOT edit the local copy in the downstream repo and rely on cascades to "preserve" your edits via `git checkout HEAD --` workarounds. That creates drift the sync mechanism then has to dance around, blocking other improvements from reaching that file in that repo.

## Spotting drift to lift

If you spot a useful predicate / helper / test / behavior in a fleet-canonical file in a downstream repo that is **not** in the template, that is a bug. Lift it up first, then re-cascade.

The fix is mechanical:

1. Diff the downstream version vs the template version.
2. Identify the additions (if there are any subtractions, those are also drift — usually they need to be added back to the downstream repo via a cascade).
3. Add the additions to the template.
4. Commit + push the template.
5. Re-cascade the downstream repo (overwrites its local copy with the now-superset canonical version).

## Why this matters

Local forks turn into "drift to preserve" hacks. Every cascade subagent has to be told to skip the locally-forked file, which makes the cascade fragile. Worse, those forks block fleet-wide improvements from reaching the forked repo: when the template's version of the file gets a real upgrade (e.g. a new fix predicate, a new exception case), the downstream repo's local copy never gets it.

The fleet's value is the shared canon. Branching locally splits the canon and erodes the value.
