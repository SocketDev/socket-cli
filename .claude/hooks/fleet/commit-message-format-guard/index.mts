#!/usr/bin/env node
// Claude Code PreToolUse hook — commit-message-format-guard.
//
// Validates `git commit -m <msg>` (and `--message=<msg>`) invocations
// against the Conventional Commits 1.0 spec. Two checks:
//
//   1. The first line of the message follows
//        <type>[(scope)][!]: <description>
//      where type ∈ { feat, fix, chore, docs, style, refactor, perf,
//      test, build, ci, revert }, type is lowercase, the colon-space
//      separator is required, and the description is non-empty.
//
//   2. No AI-attribution markers anywhere in the message body
//      ("Generated with Claude", "Co-Authored-By: Claude", 🤖 tag
//      lines, <noreply@anthropic.com>, the "Claude-Session:" trailer).
//      The Stop-hook companion commit-pr-nudge catches these at draft
//      time; this is the commit-time defense in depth.
//
// Spec: https://www.conventionalcommits.org/en/v1.0.0/
//
// Bypass phrases (one phrase = one commit):
//   - "Allow commit-format bypass"   — type/format issue
//   - "Allow ai-attribution bypass"  — explicit AI-attribution override
//     (rare; mostly for commits that legitimately document the
//     forbidden strings, e.g. a CLAUDE.md edit that quotes them as
//     examples).
//
// Hook contract:
//   - Returns a `block(message)` verdict (the runner prints message +
//     sets exitCode 2) or `undefined` (allow).
//   - Fails open on any internal error so the hook never wedges the
//     operator's flow.

import { AI_ATTRIBUTION_PATTERNS } from '../_shared/ai-attribution.mts'
import {
  extractCommitMessage,
  isGitCommit,
} from '../_shared/commit-command.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
// Conventional Commits header validation lives in the cross-tree canonical home
// .git-hooks/_shared/commit-format.mts so the commit-msg git-stage backstop
// shares THIS code (the shared thing is the validation). That module is
// side-effect-free; importing it never triggers a hook's stdin-reading main().
import {
  ALLOWED_TYPES,
  HEADER_RE,
  suggestReplacement,
  validateHeader,
} from '../../../../.git-hooks/_shared/commit-format.mts'
import type { HeaderCheck } from '../../../../.git-hooks/_shared/commit-format.mts'

// Re-exported so existing importers (and the placeholder-subject guard) can
// reach them; the canonical definitions live in _shared/commit-command.mts /
// commit-format.mts.
export { extractCommitMessage, isGitCommit }
export { HEADER_RE, suggestReplacement, validateHeader }
export type { HeaderCheck }

// Pre-flight triggers: the dispatcher skips importing this guard unless the raw
// payload contains one of these substrings. The guard can only ever block when
// `isGitCommit(command)` is true, and that detection requires the literal
// `commit` token (the regex `\bgit\b…\s+commit(?:\s|$)`). So `commit` is a
// necessary substring of every blocking command — safe to gate on.
export const triggers: readonly string[] = ['commit']

const BYPASS_FORMAT = 'Allow commit-format bypass'
const BYPASS_AI = 'Allow ai-attribution bypass'

/**
 * Scan the full message body for AI-attribution markers. Returns the first
 * matching label, or undefined when the message is clean.
 */
export function findAiAttribution(message: string): string | undefined {
  for (let i = 0, { length } = AI_ATTRIBUTION_PATTERNS; i < length; i += 1) {
    const p = AI_ATTRIBUTION_PATTERNS[i]!
    if (p.regex.test(message)) {
      return p.label
    }
  }
  return undefined
}

function blockMessage(reason: string, body: string): string {
  return `[commit-message-format-guard] ${reason}\n\n${body}\n`
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }
  const message = extractCommitMessage(command)
  if (message === undefined) {
    // No inline message — operator may be using -F file or editor; not our
    // call to enforce here.
    return undefined
  }

  // Header check first.
  /* c8 ignore next - split always returns ≥1 element; ?? '' fallback is unreachable */
  const firstLine = message.split('\n')[0] ?? ''
  const header = validateHeader(firstLine)
  if (header.kind !== 'ok') {
    if (!bypassPhrasePresent(payload.transcript_path, BYPASS_FORMAT)) {
      const suggestion = suggestReplacement(header)
      const lines: string[] = []
      if (header.kind === 'no-type') {
        lines.push(`  Missing Conventional Commits header in: "${header.line}"`)
      } else if (header.kind === 'bad-type') {
        lines.push(
          `  Unknown type "${header.type}" in: "${header.line}"`,
          `  Allowed types: ${ALLOWED_TYPES.join(', ')}`,
        )
      } else if (header.kind === 'uppercase-type') {
        lines.push(
          `  Type must be lowercase. Got "${header.type}" in: "${header.line}"`,
        )
        /* c8 ignore start - HeaderCheck union is exhausted by prior arms; false branch of this else-if is unreachable */
      } else if (header.kind === 'empty-description') {
        lines.push(`  Empty description after "${header.type}:" header.`)
      }
      /* c8 ignore stop */
      lines.push('')
      lines.push(`  Required format: <type>[(scope)][!]: <description>`)
      lines.push(`  Allowed types  : ${ALLOWED_TYPES.join(', ')}`)
      lines.push(
        `  Spec           : https://www.conventionalcommits.org/en/v1.0.0/`,
      )
      lines.push('')
      lines.push(`  Suggested fix  : ${suggestion}`)
      lines.push('')
      lines.push(`  Bypass: type "${BYPASS_FORMAT}" in a recent message.`)
      return block(
        blockMessage(
          'Commit message does not match Conventional Commits 1.0.',
          lines.join('\n'),
        ),
      )
    }
    // Operator authorized this commit. Still fall through to AI check
    // separately — bypass-format does not authorize AI attribution.
  }

  // AI-attribution check (independent of the format bypass).
  const aiLabel = findAiAttribution(message)
  if (aiLabel) {
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_AI)) {
      return undefined
    }
    const lines: string[] = []
    lines.push(`  AI-attribution marker found: ${aiLabel}`)
    lines.push('')
    lines.push('  The fleet forbids AI attribution in commit messages and PR')
    lines.push('  descriptions. Remove the offending line(s) and retry.')
    lines.push('')
    lines.push('  Patterns blocked:')
    lines.push('    - "Generated with Claude" / "Generated with Anthropic"')
    lines.push('    - "Co-Authored-By: Claude"')
    lines.push('    - Robot emoji (🤖) tag lines')
    lines.push('    - <noreply@anthropic.com> footer')
    lines.push('    - "Claude-Session:" trailer / claude.ai/code/session_ URL')
    lines.push('')
    lines.push(`  Bypass (rare): type "${BYPASS_AI}" in a recent message.`)
    lines.push('  Use only when a commit legitimately documents the strings')
    lines.push('  (e.g. CLAUDE.md edits that quote them as examples).')
    return block(
      blockMessage(
        'AI-attribution markers are forbidden in commit messages.',
        lines.join('\n'),
      ),
    )
  }

  return undefined
})

export const hook = defineHook({
  bypass: ['commit-format', 'ai-attribution'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
