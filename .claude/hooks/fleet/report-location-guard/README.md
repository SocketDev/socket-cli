# report-location-guard

PreToolUse(Edit/Write/MultiEdit) guard. Sibling of `plan-location-guard`.
Blocks report-shaped `.md` writes to committable (tracked) paths, steering them
to `<repo-root>/.claude/reports/<name>.md` — uncommittable by default.

## Trigger

A markdown write whose target path is committable AND whose filename/content
looks like a scan/audit report:

- **Blocked paths:** `**/docs/reports/**`, a bare `**/reports/**` not under
  `.claude/`, and `**/<pkg>/.claude/reports/**` (sub-package, not repo-root).
- **Report shape (at least one):** filename stem contains `report`, `scan`,
  `audit`, `findings`, `quality-scan`, `security-scan`, `security-review`; OR the
  opening `# heading` includes report/scan/audit/findings.

Allowed: `<repo-root>/.claude/reports/**/*.md` (canonical, gitignored), and any
`.md` that doesn't look like a report.

## Why

Reports are ephemeral artifacts, not version-controlled deliverables. The fleet
`.gitignore` excludes `/.claude/*` and omits `reports/` from the allowlist, so a
report under `.claude/reports/` is untracked by default. Writing one to
`docs/reports/`, a bare `reports/`, or a package `docs/` would commit it.

**Why:** a report generator that defaults to a `reports/<name>.md` path writes
into a committable tree, so the ephemeral artifact rides into version control;
the canonical home is `.claude/reports/`. Same convention + threat model as
`plan-location-guard` for `.claude/plans/`.

## Action

Exit 2 (blocks) with stderr explaining the rule, the `.claude/reports/` fix, and
the bypass phrase. Fail-open on hook bugs.

## Bypass

User types `Allow report-location bypass` verbatim in a recent message.
