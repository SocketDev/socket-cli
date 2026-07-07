# Drift watch

Companion to the `### Drift watch` rule in `template/CLAUDE.md`. The inline section gives the headline. This file enumerates where drift hides, how to check, and the cascade-PR convention.

## The principle

> Drift across fleet repos is a defect, not a feature.

When two socket-\* repos pin different versions of the same shared
resource, the divergence is a bug. The repo with the **newer version
is the source of truth**; older repos catch up.

This applies whenever a value is meant to be byte-identical (a SHA, a
hook, a CLAUDE.md fleet block) or semver-aligned (a tool version, a
Node release, a pnpm pin).

## Cascade scope is never a hazard to warn about

A fleet cascade that touches many repos and hundreds of files is the normal, safe, expected shape. The template is the source of truth and `sync-scaffolding` is the authority; a wide sweep means the fleet had drifted that far. Do NOT pause, ask, or warn because a `--all --fix` run reports a large repo count or finding count. Run it. A cascade is one atomic unit of update, not churn — see [`cascade-is-a-unit.md`](cascade-is-a-unit.md).

The recovery model is symmetric. If a cascade over-applies or applies a stale value, the fix is another cascade. There is no irreversible-action risk to gate on here, so the "confirm before hard-to-reverse outward-facing actions" instinct does not fire for cascades — they are idempotent and self-correcting. Pre-existing drift in a target repo riding along in the cascade commit is part of the design. Surface a finding only when a cascade **can't apply** (lockfile reject, soak window, broken hook): bump the blocker or defer and report.

**Why:** a session once ran the full `--all --fix` cascade and stopped to warn that a wide sweep across many repos with hundreds of findings was a "large blast radius." The operator corrected: fleet cascades are safe and known; a too-broad sweep is fixed by another cascade — do not warn, run it.

## Where drift commonly hides

- **`external-tools.json`**: pnpm / zizmor / sfw versions plus per-platform sha256s. `socket-registry`'s `setup-and-install` action is the canonical source.
- **`socket-registry/.github/actions/*`**: composite-action SHAs pinned in consumer workflows.
- **`template/CLAUDE.md` fleet block** (between the `<fleet-canonical>` markers): must be byte-identical across the fleet.
- **`template/.claude/hooks/*`**: same hook code in every repo; diverged hook code is drift.
- **`lockstep.json` `pinned_sha` rows**: upstream submodules tracked by socket-btm (lsquic, yoga, etc.).
- **`.gitmodules` `# name-version` annotations** (enforced by `.claude/hooks/fleet/gitmodules-comment-guard/`).
- **pnpm / Node `packageManager` / `engines` fields**: fleet-wide pin; any divergence is drift.

## Internal action-pin staleness (the implicit data edge)

A composite action reads its data dependencies at runtime via
`${GITHUB_ACTION_PATH}/../…` — e.g. `setup` reads `external-tools.json` and
`.github/actions/lib/`. There is no `uses:` line for that edge, so a SHA pin to
`setup` silently captures `external-tools.json` AS IT WAS at that SHA. The
DEEPEST pin in a chain therefore decides tool versions, not the entrypoint — and
a content change to the data file leaves every older pin stale with nothing to
flag it. This broke fleet CI once (a pinned pnpm version went stale behind the
edge).

`scripts/fleet/check/action-pins-are-current.mts` closes the gap. The CLOSURE of
a pinned unit = its own files ∪ each transitive internal `uses:` dep's closure ∪
its declared `# cascade-data-deps:` paths. A pin `(file, dep, sha)` is **STALE**
when `git rev-list --count <sha>..<base>` over the closure paths is non-zero,
**UNREACHABLE** when `<sha>` is not an ancestor of the base. The check is
producer-internal — it only classifies a pin whose `repo` is the repo it runs in
(so consumers and the wheelhouse no-op; consumer-side repinning is the
wheelhouse tool-pin cascade orchestrator's job — `scripts/repo/pipeline.mts`
Stage 4 Propagate). Self-enforcing: every escaping read it
detects in an action MUST be covered by a `# cascade-data-deps:` declaration, so
a new data edge cannot be added without the staleness analysis seeing it. Run
`--fix` to repin stale entries to the base HEAD with a refreshed
`# <branch> (YYYY-MM-DD)` comment.

## How to check

1. **Editing one of the above in repo A?** Grep the same thing in
   repos B/C/D before committing. If A is older, bump A first; if A
   is newer, plan a sync to B/C/D.
2. **`socket-registry`'s `setup-and-install` action** is the
   canonical source for tool SHAs. Diverging from it is drift.
3. **`socket-wheelhouse`'s `template/` tree** is the canonical
   source for `.claude/`, CLAUDE.md fleet block, and hook code.
   Diverging is drift.
4. **`node scripts/sync-scaffolding/cli.mts --all`** (in socket-wheelhouse)
   surfaces drift programmatically.

## Never silently let drift sit

Reconcile in the same PR, or open a follow-up PR titled
`chore(wheelhouse): cascade <thing> from <newer-repo>` and link it.
The `drift-check-nudge` hook nags after edits to known-drift
surfaces.

## Cascade PR convention

`chore(wheelhouse): cascade <thing> from <newer-repo>@<sha>`

Examples:

- `chore(wheelhouse): cascade Node 26.1.0 from socket-wheelhouse@87eb704`
- `chore(wheelhouse): cascade plan-location-guard from
socket-wheelhouse@d846d1c`
- `chore(wheelhouse): cascade pnpm 11.0.8 + Node 26.1.0 from
socket-registry@abc1234`

The body should list affected files + the upstream commit. The
sync-scaffolding tool produces this body automatically when run with
`--target <repo> --fix`.

## Evergreen / latest-and-greatest targets

The drift rule generalizes from "two repos pin different versions" to every
build and language target choice: default to the latest the runtime supports,
not a conservative back-version. For an auto-updating runtime (a Chrome
extension, the web, a CI-pinned Node) the `tsconfig` `target`/`lib` should be
`ESNext`, `engines.node` the current floor, `browserslist` `defaults` or `last
N versions`, and dependency floors the latest practical. A back-versioned
target downlevels or untypes modern syntax for no benefit. The motivating case
was a `tsconfig` bumped only to `ES2023` to satisfy one method, where the
runtime was evergreen and `ESNext` was the right answer.

`.claude/hooks/fleet/prefer-evergreen-target-nudge/` is a Stop nudge (never
blocks, exit 0) that flags a conservative `target`/`lib` (an `ES<year>` below
the current floor) introduced in the last assistant turn and points at
`ESNext`. JSON config (tsconfig, package.json, browserslist) is not lintable by
oxlint, so the nudge is the only enforcement surface for the principle. Bypass:
type `Allow evergreen-target bypass` in a recent message.

## See also

- `.claude/hooks/fleet/drift-check-nudge/`
- `.claude/hooks/fleet/prefer-evergreen-target-nudge/`
- `.claude/hooks/fleet/gitmodules-comment-guard/`
- `scripts/sync-scaffolding/`: drift detection + auto-fix tooling (canonical in socket-wheelhouse).
