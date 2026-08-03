# Plan storage

Companion to the _Plan storage_ fleet rule in `template/base/CLAUDE.md`. The inline rule is one sentence. This doc carries the rationale, the migration guidance for legacy `docs/plans/*` content, and the per-repo extension pattern.

## What counts as a "plan"

A design / implementation / migration document that captures **state about
work in progress or work about to start**:

- Multi-step refactor breakdowns (which files, in what order, how many LOC).
- Cross-package migration playbooks.
- Feature-design docs that enumerate JS surface + C++ binding signatures.
- "Where did we leave off" notes a future session needs to resume.
- LOC estimates, step boundaries, commit-split proposals.

What is **not** a plan (and belongs elsewhere):

- Permanent architecture docs: an `architecture/` dir under `docs/` or a top-level `<topic>.md` (tracked).
- API reference: JSDoc / TSDoc / Rustdoc / README.
- Onboarding / contributor docs: `CONTRIBUTING.md` (tracked).
- Incident post-mortems: if the lesson is worth keeping, it goes into CLAUDE.md as a rule with a `**Why:**` line per the _Compound lessons_ rule. The post-mortem itself can stay in `.claude/plans/` as scratch.

## The canonical location

`<repo-root>/.claude/plans/<lowercase-hyphenated>.md`.

One location per repo. Never:

- `docs/plans/*`: tracked; defeats the rule.
- `<pkg>/docs/plans/`: tracked + duplicates the convention per-package.
- `<pkg>/.claude/plans/`: sub-package `.claude/` is a fleet-convention smell; CLAUDE itself reads the repo-root `.claude/` for the operator's current session.

The path is shared across parallel Claude sessions in the same checkout, so
multiple plans coexist comfortably. Worktrees get their own `.claude/plans/` that disappears when the worktree is removed. That's by design.

## Untracked-by-default

The fleet `template/base/.gitignore` already excludes `/.claude/*` with an
explicit allowlist:

```gitignore
/.claude/*
!/.claude/agents/
!/.claude/commands/
!/.claude/hooks/
!/.claude/ops/
!/.claude/settings.json
!/.claude/skills/
```

`plans/` is intentionally absent from the allowlist. A freshly-written plan
is therefore untracked by default.

Do NOT:

- Add `!/.claude/plans/` to the gitignore allowlist.
- `git add .claude/plans/<file>.md`.
- Use `git add -A` / `git add .` (which would sweep the plan in; the fleet rule already forbids those flags for unrelated reasons).

## Why untracked

Plans capture state: what we're about to do, what we've ruled out, what the LOC estimates are. State decays the moment a commit lands. A plan tracked in git rots into "this file describes what main looked like 4 months ago" lies that future-you trusts. Keeping plans local-only forces the work to live in:

- The **code** — the actual implementation is the source of truth.
- **Commit messages** (capture the why at the moment the change ships).
- **CHANGELOG** (capture the consumer-visible diff at release time).

These are the surfaces that actually stay accurate, because they're
written at the moment of the change rather than weeks before it.

**Past incident:** socket-btm grew three parallel `plans/` directories (`docs/plans/*`, `packages/*/docs/plans/`, `.claude/plans/`). Same content type, three locations, all tracked, all drifting. The rule is one location, untracked.

## Migrating legacy `docs/plans/*` content

If you find a tracked plan in `docs/plans/*` or `<pkg>/docs/plans/`:

1. **Stop and ask the user before relocating.** Moving the file requires
   rewriting every reference (test files, READMEs, source comments,
   Dockerfiles, build scripts) that cites the old path. Silent migration
   is a recipe for broken links.
2. If the user approves migration:
   - Inventory references first: `rg -l "docs/plans/<filename>"` and
     `rg -l "<pkg>/docs/plans/<filename>"`.
   - If the plan is **still active** (work isn't done): move to
     `.claude/plans/<same-name>.md` (the destination is untracked, so the
     move requires `git rm <old>` + `cp <old> .claude/plans/` + plain
     filesystem cp, not `git mv`). Rewrite every reference.
   - If the plan is **finished** (work shipped): the plan has served its purpose. `git rm` the tracked copy + delete references that say "see plan X." Don't preserve dead plans as documentation; that turns them back into the rot the rule prevents.
3. Either way, the cleanup is its own commit / PR; don't bundle it with
   the work the plan describes.

## Per-repo extensions

Downstream repos can add their own plan-storage rules in **their own**
CLAUDE.md (outside the fleet block). Common extensions:

- A per-repo `README.md` under `.claude/plans/` listing currently-active plans
  with a one-line description. That README is also untracked (under
  `/.claude/*`) but operators in a fresh worktree won't have it; the
  list is regenerable from `ls -1 .claude/plans/`.
- Naming conventions for active vs archived plans (e.g.
  `wip-<name>.md` / `done-<name>.md`).
- A repo-specific plans index that the operator maintains by hand.

These all sit inside the same gitignored `/.claude/plans/` directory and
don't change the fleet rule.

## How this interacts with other fleet rules

- **`markdown-filename-guard`**: the hook accepts lowercase-hyphenated `.md` files under either `docs/` or `.claude/` (any depth). It will NOT block a `docs/plans/<name>.md` write; the guard is filename-only, not content-aware. The plan-storage convention is enforced by this rule, not by the filename guard.
- **No fleet fork**: this doc is fleet-canonical (lives under `template/base/docs/agents.md/fleet/`). Downstream copies are read-only. Edit here and cascade.
- **Drift watch**: if you find a downstream repo carrying its own diverged
  copy of this doc, reconcile back to fleet-canonical.

## The plan is a deliverable, not a paragraph

For non-trivial work, write the plan down before executing it. A plan that's genuinely a deliverable:

- **Lists steps numerically.** A reader should be able to point at "step 4" and know exactly what that means.
- **Names the actual files and rules involved.** "Update the config" is not a plan step; "edit `.config/fleet/oxlintrc.json`, add the `no-x` rule per `no-disable-lint-rule.md`" is.
- **Invites a second-opinion pass when the plan touches fleet-shared resources.** A plan that edits a cascaded config, a shared hook, or anything more than one repo depends on gets a review round before execution starts, not after.

A plan that reads as one flowing paragraph with no numbered structure has skipped the step that makes it checkable. The reports convention (`.claude/reports/`, documented in [code-style](code-style.md#generated-reports)) follows the same untracked-by-default shape as plans, one level over: scan output, not planning state.

## Enforcement

- `.claude/hooks/fleet/plan-location-guard/` — blocks writing a plan doc outside `<repo-root>/.claude/plans/<name>.md`.
- `.claude/hooks/fleet/report-location-guard/` — blocks writing a report doc outside `<repo-root>/.claude/reports/<name>.md`.
- `.claude/hooks/fleet/no-registry-mutation-in-repo-script-nudge/` — steers a one-off registry mutation script into `/tmp`, never a committed path, since that class of script is neither a plan nor a report.
- `.claude/hooks/fleet/plan-review-nudge/` — flags a prose-only "here's the plan" announcement with no numbered-step structure within roughly 20 lines.
