#!/usr/bin/env node
// Claude Code PreToolUse hook — report-location-guard.
//
// Sibling of plan-location-guard. Blocks Edit/Write/MultiEdit ops that
// try to land a scan / audit / quality / security *report* document at a
// committable (tracked) location instead of
// `<repo-root>/.claude/reports/<name>.md`. Per the fleet "Plan & report
// storage" rule, reports are ephemeral working artifacts and must not be
// tracked by version control.
//
// Blocked target paths (any depth from repo root):
//
//   - `**/docs/reports/**/*.md` — the classic "I saved the report
//     somewhere visible" failure mode (root docs/reports/ + package
//     docs/reports/).
//   - `**/reports/**/*.md` where the `reports/` dir is NOT under
//     `.claude/` — a bare tracked reports/ tree.
//   - `**/<pkg>/.claude/reports/**/*.md` — sub-package .claude/ trees
//     are not the operator's session dir; canonical is repo-root .claude/.
//
// Allowed:
//   - `<repo-root>/.claude/reports/**/*.md` — the canonical home
//     (gitignored: fleet .gitignore excludes /.claude/* and omits
//     reports/ from the allowlist, so it's untracked by default).
//   - Any `.md` whose filename + content do NOT look like a report.
//
// Heuristic for "looks like a report" — at least one of:
//   - Filename stem contains `report`, `scan`, `audit`, `findings`,
//     `quality-scan`, `security-scan`, `security-review`.
//   - Opening `# <title>` heading words include "report", "scan",
//     "audit", or "findings".
//
// The classify + heuristic + bypass engine is the shared
// `_shared/doc-location-guard.mts` (also driving plan-location-guard);
// this wrapper supplies the report-specific token lists, the bare-dir
// rule, and the message.
//
// Why a hook on top of the CLAUDE.md rule: the rule documents the
// convention; the hook enforces it at edit time. Incident (2026-06-05):
// the scanning-quality skill defaulted to a tracked reports path;
// the operator wants reports in the plans directory, uncommittable.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit" | "Write" | "MultiEdit",
//     "tool_input": { "file_path": "...",
//                     "content"?: "...",
//                     "new_string"?: "..." },
//     "transcript_path": "/.../session.jsonl" }
//
// Exits:
//   0 — allowed.
//   2 — blocked (stderr explains rule + fix + bypass phrase).
//   0 (with stderr log) — fail-open on hook bugs.

import {
  basenameStem,
  classifyDocPath,
  contentLooksLikeDoc,
  filenameLooksLikeDoc,
  makeDocLocationCheck,
} from '../_shared/doc-location-guard.mts'
import { defineHook, runHook } from '../_shared/guard.mts'

const BYPASS_PHRASE = 'Allow report-location bypass'

// Filename-stem tokens that mark a doc as "report-shaped." Checked on
// the base name (extension stripped, lowercased).
const REPORT_FILENAME_TOKENS = [
  'report',
  'scan',
  'audit',
  'findings',
  'quality-scan',
  'security-scan',
  'security-review',
]

// First-heading tokens that mark a doc as "report-shaped." Checked
// against the first non-blank line if the filename heuristic missed.
const REPORT_HEADING_TOKENS = ['report', 'scan', 'audit', 'findings']

// The stem/classify/heuristic helpers are the shared doc-location ones,
// re-exported (specialized to the report shape) so this guard's tests
// exercise the exact predicates the check runs.
export { basenameStem }

export function classifyPath(filePath: string): string {
  return classifyDocPath(filePath, 'reports', true)
}

export function contentLooksLikeReport(content: string | undefined): boolean {
  return contentLooksLikeDoc(content, REPORT_HEADING_TOKENS)
}

export function filenameLooksLikeReport(filePath: string): boolean {
  return filenameLooksLikeDoc(filePath, REPORT_FILENAME_TOKENS)
}

export const check = makeDocLocationCheck({
  bareDirBlocked: true,
  blockMessage: (filePath, classification) =>
    [
      `🚨 report-location-guard: blocked report-shaped .md write at a committable location.`,
      ``,
      `File:           ${filePath}`,
      `Classification: ${classification}`,
      ``,
      `Per the fleet "Plan & report storage" rule (CLAUDE.md), scan / audit /`,
      `quality / security reports live at <repo-root>/.claude/reports/<name>.md`,
      `and must NOT be tracked. The fleet .gitignore excludes /.claude/* and`,
      `omits reports/ from the allowlist — a report written there is untracked`,
      `by default. Never save reports to docs/reports/, a bare reports/, or a`,
      `package docs/ — those are committable.`,
      ``,
      `Fix:`,
      `  Move the report to <repo-root>/.claude/reports/<lowercase-hyphenated>.md`,
      ``,
      `One-shot bypass (rare): user types "${BYPASS_PHRASE}" verbatim`,
      `in a recent message.`,
      ``,
    ].join('\n'),
  bypassPhrase: BYPASS_PHRASE,
  dirName: 'reports',
  filenameTokens: REPORT_FILENAME_TOKENS,
  headingTokens: REPORT_HEADING_TOKENS,
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
