# plan-location-guard

PreToolUse hook that blocks plan-shaped `.md` writes to tracked locations.

## What it blocks

Edit / Write / MultiEdit on a markdown file is blocked when:

1. The target path lives under `docs/plans/` (at any depth), OR
2. The target path lives under a sub-package `.claude/plans/` (i.e.
   any `.claude/plans/` that is NOT at the repo root — detected by
   the presence of a `packages/`, `apps/`, or `crates/` segment in
   the path prefix, OR by finding a second `.claude/plans/` deeper
   than the first).

AND the doc looks like a plan, per a narrow heuristic:

- Filename stem contains one of: `plan`, `roadmap`, `migration`,
  `design`, `next-steps`, `dispatcher-plan`.
- OR the first heading of the content contains one of: `plan`,
  `roadmap`, `migration plan`, `design doc`.

Both conditions must be true to block — paths that look like plan
*locations* but don't have plan-shaped content are pass-through. This
keeps the hook narrow; the goal is to catch the specific failure
mode where a design doc gets dropped into `docs/plans/`.

## What it allows

- `<repo-root>/.claude/plans/<name>.md` — the canonical home (untracked).
- Random `.md` writes outside `docs/plans/` and `.claude/plans/`.
- Markdown writes that don't look like plans (e.g. a `README.md` that
  happens to live under `docs/plans/`).
- Bash / Read / non-Edit tool calls.

## Bypass phrase

`Allow plan-location bypass` — the user types this verbatim in a
recent (last 8 user turns) message. The hook reads the transcript via
the `_shared/transcript.mts` helper.

## Why a hook on top of the CLAUDE.md rule

The CLAUDE.md rule documents the convention. The hook is the actual
enforcement at edit time. The recurring failure mode this rule was
written to address: socket-btm grew three parallel `docs/plans/`
directories (root, package-level, `.claude/plans/`) — same content
type, all tracked, all drifting. Without an edit-time guard, that
failure mode recurs every session a new agent reaches for "the
obvious place" to put a plan.

## Reading

- `docs/claude.md/fleet/plan-storage.md` — full rule + migration playbook.
- CLAUDE.md → `### Plan storage` — inline summary.
