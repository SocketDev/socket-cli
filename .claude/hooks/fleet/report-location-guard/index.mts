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
// Narrow on purpose: this catches the specific failure mode (writing a
// scan/audit report into a tracked path), not every .md in the fleet.
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

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow report-location bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

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

/**
 * Lowercased filename without extension. Empty string for paths without a
 * basename.
 */
export function basenameStem(filePath: string): string {
  const base = path.basename(filePath)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.toLowerCase()
}

/**
 * Classify the target path. Returns:
 *
 * - 'allowed-root-claude-reports' — under <root>/.claude/reports/
 * - 'blocked-docs-reports' — under <something>/docs/reports/
 * - 'blocked-bare-reports' — under a reports/ dir NOT inside .claude/
 * - 'blocked-sub-claude-reports' — under <pkg>/.claude/reports/ (not root)
 * - 'irrelevant' — none of the above
 *
 * Purely lexical on the resolved path.
 */
export function classifyPath(filePath: string): string {
  const normalized = normalizePath(filePath)
  const segs = normalized.split('/')

  // First `.claude/reports/` segment pair (canonical) vs a deeper one.
  let firstClaudeIdx = -1
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === '.claude' && segs[i + 1] === 'reports') {
      firstClaudeIdx = i
      break
    }
  }

  if (firstClaudeIdx !== -1) {
    for (let i = firstClaudeIdx + 2; i < segs.length - 1; i++) {
      if (segs[i] === '.claude' && segs[i + 1] === 'reports') {
        return 'blocked-sub-claude-reports'
      }
    }
    const prefix = segs.slice(0, firstClaudeIdx).join('/')
    if (
      prefix.includes('/packages/') ||
      prefix.includes('/apps/') ||
      prefix.includes('/crates/')
    ) {
      return 'blocked-sub-claude-reports'
    }
    return 'allowed-root-claude-reports'
  }

  // docs/reports/ anywhere.
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'docs' && segs[i + 1] === 'reports') {
      return 'blocked-docs-reports'
    }
  }

  // A bare reports/ dir not under .claude/ (already handled above).
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'reports') {
      return 'blocked-bare-reports'
    }
  }

  return 'irrelevant'
}

export function contentLooksLikeReport(content: string | undefined): boolean {
  if (!content) {
    return false
  }
  let firstLine = ''
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) {
      firstLine = trimmed.toLowerCase()
      break
    }
  }
  if (!firstLine.startsWith('#')) {
    return false
  }
  return REPORT_HEADING_TOKENS.some(token => firstLine.includes(token))
}

export function filenameLooksLikeReport(filePath: string): boolean {
  const stem = basenameStem(filePath)
  if (!stem) {
    return false
  }
  return REPORT_FILENAME_TOKENS.some(token => stem.includes(token))
}

export const check = editGuard((filePath, content, payload) => {
  if (!filePath.toLowerCase().endsWith('.md')) {
    return undefined
  }

  const classification = classifyPath(filePath)
  if (
    classification !== 'blocked-bare-reports' &&
    classification !== 'blocked-docs-reports' &&
    classification !== 'blocked-sub-claude-reports'
  ) {
    return undefined
  }

  const looksLikeReport =
    filenameLooksLikeReport(filePath) || contentLooksLikeReport(content)
  if (!looksLikeReport) {
    return undefined
  }

  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }

  return block(
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
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
