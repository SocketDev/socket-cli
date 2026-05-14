#!/usr/bin/env node
// Claude Code PreToolUse hook — plan-location-guard.
//
// Blocks Edit/Write/MultiEdit operations that try to land a
// design/implementation/migration *plan* document at a tracked
// location instead of `<repo-root>/.claude/plans/<name>.md`. Per the
// fleet "Plan storage" rule, plans are working notes and must not be
// tracked by version control.
//
// Blocked target paths (case-insensitive on the `plans/` segment,
// any depth from repo root):
//
//   - `**/docs/plans/**/*.md`
//     The classic "I wrote a design doc somewhere visible" failure
//     mode. Covers root `docs/plans/` and any package-level
//     `<pkg>/docs/plans/`.
//
//   - `**/<pkg>/.claude/plans/**/*.md` (i.e. .claude/plans/ that is
//     NOT at the repo root)
//     Sub-package .claude/ trees are not part of the operator's
//     session-level .claude/ — the canonical operator dir is the
//     repo root.
//
// Allowed:
//   - `<repo-root>/.claude/plans/**/*.md` — the canonical home.
//   - Any `.md` whose filename, headings, and content do NOT look
//     like a plan (we only block when filename + content match the
//     plan-shape heuristic; other docs are out of scope).
//
// Heuristic for "looks like a plan" — at least one of:
//   - Filename contains `plan`, `roadmap`, `migration`, `dispatcher-plan`,
//     `design`, `next-steps`, or `*-plan-*.md` shape.
//   - File content (the `new_string` / `content` payload from
//     Edit/Write) opens with a `# <title>` heading whose words
//     include "plan", "roadmap", "migration plan", or "design doc".
//
// The heuristic is intentionally narrow: this hook is not trying to
// classify every .md file in the fleet — it's catching the specific
// failure mode where someone writes a design doc into `docs/plans/`
// because that's what "feels right." Random `.md` writes outside
// `docs/plans/` and `.claude/plans/` are pass-through.
//
// Bypass phrase: `Allow plan-location bypass`. Reading recent user
// turns follows the same pattern as no-revert-guard /
// no-fleet-fork-guard.
//
// Why a hook on top of the CLAUDE.md rule: the rule documents the
// convention; the hook is the actual enforcement at edit time.
// Catches the recurring failure mode where Claude or a parallel
// session writes a design doc into `docs/plans/` because that's the
// historical convention (see the socket-btm migration that triggered
// this rule — three parallel `docs/plans/` directories drifted).
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
//   2 — blocked (with stderr message that explains rule + fix +
//       bypass phrase).
//   0 (with stderr log) — fail-open on hook bugs.

import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?:
    | {
        content?: string | undefined
        file_path?: string | undefined
        new_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
  transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow plan-location bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// Filename-stem tokens that mark a doc as "plan-shaped." The check
// is on the base name (extension stripped, lowercased).
const PLAN_FILENAME_TOKENS = [
  'plan',
  'roadmap',
  'migration',
  'design',
  'next-steps',
  'dispatcher-plan',
]

// First-heading tokens that mark a doc as "plan-shaped." Checked
// against the first non-blank line of the new content if the
// filename heuristic didn't fire.
const PLAN_HEADING_TOKENS = [
  'plan',
  'roadmap',
  'migration plan',
  'design doc',
]

/**
 * Lowercased filename without extension. Returns empty string for
 * paths without a basename.
 */
function basenameStem(filePath: string): string {
  const base = path.basename(filePath)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.toLowerCase()
}

function filenameLooksLikePlan(filePath: string): boolean {
  const stem = basenameStem(filePath)
  if (!stem) {
    return false
  }
  return PLAN_FILENAME_TOKENS.some(token => stem.includes(token))
}

function contentLooksLikePlan(content: string | undefined): boolean {
  if (!content) {
    return false
  }
  // First non-blank line.
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
  return PLAN_HEADING_TOKENS.some(token => firstLine.includes(token))
}

/**
 * Classify the target path. Returns:
 *   - 'allowed-root-claude-plans' — under <something>/.claude/plans/
 *   - 'blocked-docs-plans'        — under <something>/docs/plans/
 *   - 'blocked-sub-claude-plans'  — under <something>/<sub>/.claude/plans/
 *                                   (i.e. not at the first .claude/ segment)
 *   - 'irrelevant'                — none of the above
 *
 * The classification is purely lexical on the resolved path. It does
 * NOT walk for a repo root, since the fleet rule applies to any
 * docs/plans/ regardless of repo context — including the case where
 * a script under /tmp tries to write into a project tree.
 */
function classifyPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const segs = normalized.split('/')

  // Find the FIRST `.claude/plans/` segment pair vs any DEEPER one.
  // The "first" one nearest the root is the canonical operator dir;
  // anything deeper (i.e. `<pkg>/.claude/plans/`) is a sub-package
  // plans dir and is forbidden.
  let firstClaudeIdx = -1
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === '.claude' && segs[i + 1] === 'plans') {
      firstClaudeIdx = i
      break
    }
  }

  if (firstClaudeIdx !== -1) {
    // Look for a SECOND `.claude/plans/` deeper than the first.
    for (let i = firstClaudeIdx + 2; i < segs.length - 1; i++) {
      if (segs[i] === '.claude' && segs[i + 1] === 'plans') {
        return 'blocked-sub-claude-plans'
      }
    }
    // Check whether the first `.claude/plans/` is itself nested under
    // another package directory (heuristic: preceded by `packages/`,
    // `apps/`, or `crates/` in the parent path).
    const prefix = segs.slice(0, firstClaudeIdx).join('/')
    if (
      prefix.includes('/packages/') ||
      prefix.includes('/apps/') ||
      prefix.includes('/crates/')
    ) {
      return 'blocked-sub-claude-plans'
    }
    return 'allowed-root-claude-plans'
  }

  // Look for any `docs/plans/` segment pair.
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'docs' && segs[i + 1] === 'plans') {
      return 'blocked-docs-plans'
    }
  }

  return 'irrelevant'
}

async function main(): Promise<number> {
  const raw = await readStdin()
  if (!raw.trim()) {
    return 0
  }

  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.stderr.write(
      'plan-location-guard: failed to parse stdin payload — fail-open\n',
    )
    return 0
  }

  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') {
    return 0
  }

  const filePath = payload.tool_input?.file_path
  if (!filePath) {
    return 0
  }

  // Only target markdown files.
  if (!filePath.toLowerCase().endsWith('.md')) {
    return 0
  }

  const classification = classifyPath(filePath)
  if (
    classification !== 'blocked-docs-plans' &&
    classification !== 'blocked-sub-claude-plans'
  ) {
    return 0
  }

  // Apply the plan-shape heuristic. If the doc clearly looks like a
  // plan (filename OR opening heading), block. If neither fires, this
  // is probably a coincidence (e.g. an unrelated doc that happened
  // to live under docs/plans/ for historical reasons) — let it through
  // and let the human decide.
  const content =
    payload.tool_input?.new_string ?? payload.tool_input?.content
  const looksLikePlan =
    filenameLooksLikePlan(filePath) || contentLooksLikePlan(content)
  if (!looksLikePlan) {
    return 0
  }

  // Bypass-phrase check.
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return 0
  }

  const suggestion =
    classification === 'blocked-docs-plans'
      ? 'Move the plan to <repo-root>/.claude/plans/<lowercase-hyphenated>.md (untracked by default).'
      : 'Move the plan to the REPO-ROOT .claude/plans/ — sub-package .claude/plans/ is not the canonical home.'

  process.stderr.write(
    [
      `🚨 plan-location-guard: blocked plan-shaped .md write at a tracked location.`,
      ``,
      `File:           ${filePath}`,
      `Classification: ${classification}`,
      ``,
      `Per the fleet "Plan storage" rule (CLAUDE.md → Plan storage),`,
      `plans live at <repo-root>/.claude/plans/<name>.md and must NOT`,
      `be tracked by version control. The fleet .gitignore excludes`,
      `/.claude/* and intentionally omits plans/ from the allowlist —`,
      `so a plan written to the canonical path is untracked by default.`,
      ``,
      `Fix:`,
      `  ${suggestion}`,
      ``,
      `Background reading:`,
      `  docs/claude.md/fleet/plan-storage.md`,
      ``,
      `One-shot bypass (rare): user types "${BYPASS_PHRASE}" verbatim`,
      `in a recent message.`,
      ``,
    ].join('\n'),
  )
  return 2
}

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(
      `plan-location-guard: hook error — fail-open: ${String(err)}\n`,
    )
    process.exit(0)
  },
)
