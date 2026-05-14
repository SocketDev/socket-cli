# Plan storage

Companion to the *Plan storage* fleet rule in `template/CLAUDE.md`. The
inline rule is intentionally one sentence; this doc carries the rationale,
the migration guidance for legacy `docs/plans/` content, and the
per-repo extension pattern.

## What counts as a "plan"

A design / implementation / migration document that captures **state about
work in progress or work about to start**:

- Multi-step refactor breakdowns (which files, in what order, how many LOC).
- Cross-package migration playbooks.
- Feature-design docs that enumerate JS surface + C++ binding signatures.
- "Where did we leave off" notes a future session needs to resume.
- LOC estimates, step boundaries, commit-split proposals.

What is **not** a plan (and belongs elsewhere):

- Permanent architecture docs → `docs/architecture/` or a top-level
  `<topic>.md` (tracked).
- API reference → JSDoc / TSDoc / Rustdoc / README.
- Onboarding / contributor docs → `CONTRIBUTING.md` (tracked).
- Incident post-mortems → if the lesson is worth keeping, it goes into
  CLAUDE.md as a rule with a `**Why:**` line per the *Compound lessons*
  rule. The post-mortem itself can stay in `.claude/plans/` as scratch.

## The canonical location

`<repo-root>/.claude/plans/<lowercase-hyphenated>.md`.

One location per repo. Never:
- `docs/plans/` — that's tracked, defeats the rule.
- `<pkg>/docs/plans/` — tracked + duplicates the convention per-package.
- `<pkg>/.claude/plans/` — sub-package `.claude/` is a fleet-convention
  smell; CLAUDE itself reads the repo-root `.claude/` for the operator's
  current session.

The path is shared across parallel Claude sessions in the same checkout, so
multiple plans coexist comfortably. Worktrees get their own `.claude/plans/`
that disappears when the worktree is removed — that's intentional.

## Untracked-by-default

The fleet `template/.gitignore` already excludes `/.claude/*` with an
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
- Use `git add -A` / `git add .` (which would sweep the plan in — but the
  fleet rule already forbids those flags for unrelated reasons).

## Why untracked

Plans capture state — what we're about to do, what we've ruled out, what
the LOC estimates are. State decays the moment a commit lands. A plan
tracked in git rots into "this file describes what main looked like 4
months ago" lies that future-you trusts. Keeping plans local-only forces
the work to live in:

- The **code** (the actual implementation is the source of truth).
- **Commit messages** (capture the why at the moment the change ships).
- **CHANGELOG** (capture the consumer-visible diff at release time).

These are the surfaces that actually stay accurate, because they're
written at the moment of the change rather than weeks before it.

**Past incident:** socket-btm grew three parallel `plans/` directories
(`docs/plans/`, `packages/*/docs/plans/`, `.claude/plans/`) — same content
type, three locations, all tracked, all drifting. The rule is one location,
untracked.

## Migrating legacy `docs/plans/` content

If you find a tracked plan in `docs/plans/` or `<pkg>/docs/plans/`:

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
   - If the plan is **finished** (work shipped): the plan has served its
     purpose. `git rm` the tracked copy + delete references that say
     "see plan X." Don't preserve dead plans as documentation — that
     turns them back into the rot the rule prevents.
3. Either way, the cleanup is its own commit / PR; don't bundle it with
   the work the plan describes.

## Per-repo extensions

Downstream repos can add their own plan-storage rules in **their own**
CLAUDE.md (outside the fleet block). Common extensions:

- A per-repo `.claude/plans/README.md` listing currently-active plans
  with a one-line description. That README is also untracked (under
  `/.claude/*`) but operators in a fresh worktree won't have it; the
  list is regenerable from `ls -1 .claude/plans/`.
- Naming conventions for active vs archived plans (e.g.
  `wip-<name>.md` / `done-<name>.md`).
- A repo-specific plans index that the operator maintains by hand.

These all sit inside the same gitignored `/.claude/plans/` directory and
don't change the fleet rule.

## How this interacts with other fleet rules

- **`markdown-filename-guard`**: the hook accepts lowercase-hyphenated
  `.md` files under either `docs/` or `.claude/` (any depth). It will NOT
  block a `docs/plans/<name>.md` write — the guard is filename-only, not
  content-aware. The plan-storage convention is enforced by this rule, not
  by the filename guard.
- **No fleet fork**: this doc is fleet-canonical (lives under
  `template/docs/claude.md/fleet/`). Downstream copies are read-only —
  edit here and cascade.
- **Drift watch**: if you find a downstream repo carrying its own diverged
  copy of this doc, reconcile back to fleet-canonical.
