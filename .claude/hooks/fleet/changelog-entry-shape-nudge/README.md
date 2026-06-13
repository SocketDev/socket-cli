# changelog-entry-shape-nudge

PreToolUse(Edit|Write) hook, non-blocking. Nudges when a `CHANGELOG.md` edit
adds a top-level entry bullet that links no detail into
`docs/agents.md/{fleet,repo}/<topic>.md`.

## What it catches

A `CHANGELOG.md` Write (full content) or Edit (new_string) that adds a
column-0 `- ` / `* ` entry bullet with no `docs/agents.md/` link. Indented
sub-bullets, headings, and blank lines are ignored.

## Why

A CHANGELOG entry is a one-line bullet stating the user-visible change, with the
rationale and mechanism linked to an agents.md doc:

    - <user-visible change> ([`topic`](docs/agents.md/fleet/<topic>.md))

The doc is the source of truth; the changelog stays a scannable index, the same
diet pattern the CLAUDE.md reference card uses (detail defers to
`docs/agents.md/`). Inline prose duplicates the doc and drifts from it.

This is a NUDGE, not a guard: a short bullet without a doc yet is common
mid-work. Prose quality (`prose-antipattern-guard`) and impl-detail
(`Allow changelog-impl-detail bypass`) are the separate hard gates.

## Bypass

None — it never blocks. Rewrite the entry as a bullet + agents.md link.

## Exit codes

- `0` — always (warning only). Fails open on any internal error.
