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
// The classify + heuristic + bypass engine is the shared
// `_shared/doc-location-guard.mts` (also driving report-location-guard);
// this wrapper supplies the plan-specific token lists and message.
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

import {
  basenameStem,
  classifyDocPath,
  contentLooksLikeDoc,
  filenameLooksLikeDoc,
  makeDocLocationCheck,
} from '../_shared/doc-location-guard.mts'
import { defineHook, runHook } from '../_shared/guard.mts'

const BYPASS_PHRASE = 'Allow plan-location bypass'

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
const PLAN_HEADING_TOKENS = ['plan', 'roadmap', 'migration plan', 'design doc']

// The stem/classify/heuristic helpers are the shared doc-location ones,
// re-exported (specialized to the plan shape) so this guard's tests
// exercise the exact predicates the check runs.
export { basenameStem }

export function classifyPath(filePath: string): string {
  return classifyDocPath(filePath, 'plans')
}

export function contentLooksLikePlan(content: string | undefined): boolean {
  return contentLooksLikeDoc(content, PLAN_HEADING_TOKENS)
}

export function filenameLooksLikePlan(filePath: string): boolean {
  return filenameLooksLikeDoc(filePath, PLAN_FILENAME_TOKENS)
}

export const check = makeDocLocationCheck({
  blockMessage: (filePath, classification) => {
    const suggestion =
      classification === 'blocked-docs-plans'
        ? 'Move the plan to <repo-root>/.claude/plans/<lowercase-hyphenated>.md (untracked by default).'
        : 'Move the plan to the REPO-ROOT .claude/plans/ — sub-package .claude/plans/ is not the canonical home.'
    return [
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
      `  docs/agents.md/fleet/plan-storage.md`,
      ``,
      `One-shot bypass (rare): user types "${BYPASS_PHRASE}" verbatim`,
      `in a recent message.`,
      ``,
    ].join('\n')
  },
  bypassPhrase: BYPASS_PHRASE,
  dirName: 'plans',
  filenameTokens: PLAN_FILENAME_TOKENS,
  headingTokens: PLAN_HEADING_TOKENS,
})

export const hook = defineHook({
  bypass: ['plan-location'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
