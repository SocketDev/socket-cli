#!/usr/bin/env node
// Claude Code PreToolUse hook — mermaid-github-safe-nudge.
//
// GitHub renders mermaid with floating control clusters INSIDE the
// diagram container (copy/expand top-right, a six-button pan/zoom
// cluster mid-right), so diagram content near the right edge gets
// covered. This took three PR-body render cycles to learn on a sequence
// diagram; the shapes are codified in _shared/mermaid-github.mts and
// this nudge fires whenever written content carries a mermaid fence
// that violates them — naming the exact rewrite and the wheelhouse
// fixer. Advisory only: a diagram not destined for GitHub is fine as
// written.

import { analyzeMarkdownMermaid } from '../_shared/mermaid-github.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveEditedText } from '../_shared/payload.mts'

const MAX_LISTED = 6

function analyzeText(text: string): GuardResult {
  if (!text.includes('```mermaid')) {
    return undefined
  }
  const { issues } = analyzeMarkdownMermaid(text)
  if (issues.length === 0) {
    return undefined
  }
  const listed = issues.slice(0, MAX_LISTED)
  return notify(
    `mermaid-github-safe-nudge: ${issues.length} GitHub-render issue(s) in the mermaid block(s):\n` +
      `${listed.map(i => `  - line ${i.line}: ${i.message}`).join('\n')}\n` +
      `  GitHub floats its control clusters over the diagram's right edge.\n` +
      `  Fix in place: node scripts/repo/gen/mermaid-github-safe.mts <file> (wheelhouse), or apply the rewrites above.`,
  )
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const tool = payload.tool_name
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') {
    const text = resolveEditedText(payload)
    if (!text) {
      return undefined
    }
    return analyzeText(text)
  }
  if (tool === 'Bash') {
    // A PR body assembled inline (gh pr create --body "…" / a heredoc)
    // never passes through Edit/Write — scan the command text itself.
    const command = payload.tool_input?.command
    if (typeof command !== 'string') {
      return undefined
    }
    return analyzeText(command)
  }
  return undefined
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit', 'Bash'],
  triggers: ['mermaid'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
