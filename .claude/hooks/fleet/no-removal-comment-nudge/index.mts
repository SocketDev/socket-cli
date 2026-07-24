#!/usr/bin/env node
// Claude Code PreToolUse hook — no-removal-comment-nudge.
//
// @file Heuristic: a comment explaining where something went belongs at the ADD
//   site, not the removal site. A comment left where code was deleted is
//   orphaned noise — the reader has nothing to attach it to. Only the ADD site
//   has context a junior reader can act on ("X now lives in Y" is useful next
//   to the import/call/config that replaces it; it is useless next to the
//   blank line where something used to be).
//
// Detection (three modes, on Edit/MultiEdit):
//   - Relocation (removal-gated): old_string REMOVES ≥1 code line AND
//     new_string ADDS a comment carrying a relocation phrase — "moved to",
//     "now lives", "no longer here", "lives in", "handled elsewhere", etc.
//   - Temporal narration (ungated): new_string ADDS a comment narrating the
//     dead past — "used to be", "that/which replaced the", "replaced the
//     old/legacy", "formerly known as", "no longer used". Describe the present
//     state; the deprecated past is noise the reader never needs.
//   - Negation / disclaimer (ungated): new_string ADDS a comment that defines
//     the code by what it is NOT, lacks, or is not like — "not a fork", "not a
//     derivative", "inspired by X", "unlike X", "we don't include a Y".
//     Describe what the code IS; never comment on what it isn't or lacks. When
//     something is removed or absent, the code simply doesn't mention it.
//
//   Does NOT fire when:
//   - Only comments changed (no code removal).
//   - The added comment doesn't carry a relocation phrase.
//   - The comment was already present in old_string (not newly added).
//   - Write tool calls (no old/new distinction — Write replaces the whole
//     file, so there's no meaningful "removal site" context).
//
// Heuristic limitation:
//   The hook operates on the Edit fragment (old_string/new_string), not the
//   full file. A relocation phrase in a newly added comment strongly suggests
//   the author is annotating a removal site — but the hook can't guarantee
//   the comment will be orphaned after surrounding context is read. False
//   positives are possible (e.g. "# now lives in src/utils" added alongside
//   new code that replaces older code in the same fragment). The bar is
//   "obvious removal-site annotation", not "provably orphaned". When in doubt,
//   the hook stays silent (exits 0 without nudging).
//
// Bypass: no phrase — nudge never blocks, always exits 0.

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// A line is a comment if it starts (after optional whitespace) with a
// comment marker. Covers: `//`, `#`, `*` (block-comment continuation),
// `/*`, `*/`. Does NOT cover inline comments (`code // comment`) — those
// are treated as code lines because the code portion is present.
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*\/|\*|#)\s*/

// A line is a code line when it is non-empty AND is not a comment line.
// Blank lines and comment-only lines are excluded.
function isCodeLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && !COMMENT_LINE_RE.test(trimmed)
}

// A comment line is "newly added" when it appears in new_string but not in
// old_string. We compare by normalized text (strip the comment marker and
// trim) to avoid flagging a re-indented existing comment.
function commentText(line: string): string {
  return line.replace(COMMENT_LINE_RE, '').trim().toLowerCase()
}

// Relocation phrases that signal a removal-site comment. Kept narrow to
// minimize false positives — only phrases that clearly mean "the thing that
// WAS here is now somewhere else" qualify.
//
// Intentionally excluded:
//   - "see X" / "see above" / "see below" — these are pointer comments,
//     already handled by pointer-comment-nudge; they also appear legitimately
//     at non-removal sites.
//   - General "removed" / "formerly" — covered by no-meta-comments-guard.
//   - "TODO" / "FIXME" prefixes — separate concern.
const RELOCATION_RE =
  /\b(?:handled\s+(?:above|below|by|elsewhere|in)|lives?\s+in\b|managed\s+(?:above|below|by|here|in)|moved?\s+(?:above|below|from|here|into|to)|no\s+longer\s+(?:here|lives?|needed\s+here)|now\s+(?:lives?\s+(?:above|at|below|in)|managed\s+(?:above|below|here))|relocated\s+(?:above|below|from|to)|used?\s+to\s+(?:be|live)\s+(?:at|here|in))\b/i

// Temporal-deprecation NARRATION: a comment that describes the dead past
// instead of the present. Distinct from RELOCATION_RE — this fires anywhere
// (no code-removal gate) because narrating "what it used to be" is noise even
// far from a deletion. Kept to distinctive multi-word shapes so it doesn't
// false-positive on ordinary prose ("no longer than 80 chars", "the value
// replaced in the map"): a temporal contrast ("used to be"), a replacement
// narration ("that/which replaced the", "replaced the old/legacy/former"),
// a rename narration ("formerly known as"), or a hard "no longer used".
const TEMPORAL_NARRATION_RE =
  /\b(?:(?:that|which)\s+replaced\s+the|formerly\s+(?:called|known\s+as|named|the)|migrated\s+away\s+from|no\s+longer\s+(?:in\s+use|used)|replaced\s+the\s+(?:former|legacy|old|previous|prior)|used\s+to\s+be)\b/i

// Negation / DISCLAIMER: a comment that defines the code by what it is NOT,
// lacks, or is not like, instead of what it IS. Fires anywhere (no code-removal
// gate) — an identity/comparison disclaimer is noise regardless of context.
// Kept to distinctive derivation/comparison/lack shapes so ordinary behavioral
// negation ("does not mutate std::env", "not yet stable", "no unsafe") does NOT
// match: a derivation disclaimer ("not a fork", "not derived from"), an
// affiliation/inspiration disclaimer ("not affiliated", "inspired by"), a
// comparison ("unlike X", "as opposed to"), or an explicit feature-lack
// ("we don't include a Y", "no longer a Z").
const NEGATION_RE =
  /\b(?:(?:it|this|we)\s+(?:do(?:es)?\s+not|doesn'?t|don'?t)\s+(?:bundle|have|include|provide|ship|vendor)\s+(?:a|an|any)|as\s+opposed\s+to|in\s+contrast\s+to|inspired\s+by|no\s+affiliation\s+with|no\s+longer\s+(?:a|an)\b|not\s+(?:a|an)\s+(?:clone|copy|derivation|derivative|drop-in|fork|port|reimplementation|rewrite|variant)|not\s+(?:based|derived)\s+(?:on|off|from|of)|not\s+affiliated|not\s+like|rather\s+than\s+being|unlike)\b/i

/**
 * Result of inspecting an Edit's old/new fragments.
 */
export interface RemovalCommentFinding {
  readonly kind: 'negation' | 'relocation' | 'temporal'
  readonly phrase: string
  readonly commentSnippet: string
}

/**
 * Inspect old_string / new_string for the removal-site comment pattern.
 * Pure — no I/O. Returns a finding when the heuristic fires, else undefined.
 *
 * Algorithm:
 *
 * 1. Split both fragments into lines.
 * 2. Check old_string has at least one code line (non-comment, non-blank).
 * 3. Build a set of comment texts that exist in old_string (so we can skip
 *    comments that weren't newly added).
 * 4. For each comment line in new_string that is NOT already in old_string, check
 *    whether its text matches RELOCATION_RE.
 * 5. Fire on the first match.
 */
export function detectRemovalComment(
  oldStr: string,
  newStr: string,
): RemovalCommentFinding | undefined {
  if (!oldStr || !newStr || oldStr === newStr) {
    return undefined
  }

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  // A removed code line gates the relocation mode (a relocation note is only
  // orphaned noise next to a deletion). Temporal narration is NOT gated — a
  // comment narrating the dead past is noise anywhere.
  const hasCodeRemoval = oldLines.some(isCodeLine)

  // Comment texts already present in old_string, so an existing (re-indented)
  // comment isn't treated as newly added.
  const existingCommentTexts = new Set<string>()
  for (let i = 0, { length } = oldLines; i < length; i += 1) {
    const line = oldLines[i]!
    if (COMMENT_LINE_RE.test(line.trimStart()) && line.trim().length > 0) {
      existingCommentTexts.add(commentText(line))
    }
  }

  // Scan new_string for newly added comments. Temporal narration fires first
  // (ungated); relocation fires only when code was removed.
  for (let i = 0, { length } = newLines; i < length; i += 1) {
    const line = newLines[i]!
    const trimmed = line.trim()
    if (!trimmed || !COMMENT_LINE_RE.test(trimmed)) {
      continue
    }
    const text = commentText(line)
    if (existingCommentTexts.has(text)) {
      continue
    }
    const temporal = TEMPORAL_NARRATION_RE.exec(text)
    if (temporal) {
      return {
        kind: 'temporal',
        phrase: temporal[0],
        commentSnippet: trimmed.slice(0, 80),
      }
    }
    const negation = NEGATION_RE.exec(text)
    if (negation) {
      return {
        kind: 'negation',
        phrase: negation[0],
        commentSnippet: trimmed.slice(0, 80),
      }
    }
    if (hasCodeRemoval) {
      const m = RELOCATION_RE.exec(text)
      if (m) {
        return {
          kind: 'relocation',
          phrase: m[0],
          commentSnippet: trimmed.slice(0, 80),
        }
      }
    }
  }
  return undefined
}

/**
 * Same as detectRemovalComment but handles MultiEdit's array of
 * { old_string, new_string } edits. Returns the first finding.
 */
export function detectRemovalCommentInEdits(
  edits: ReadonlyArray<{ old_string: string; new_string: string }>,
): RemovalCommentFinding | undefined {
  for (let i = 0, { length } = edits; i < length; i += 1) {
    const edit = edits[i]!
    const finding = detectRemovalComment(edit.old_string, edit.new_string)
    if (finding) {
      return finding
    }
  }
  return undefined
}

function buildMessage(finding: RemovalCommentFinding): string {
  if (finding.kind === 'negation') {
    return [
      '[no-removal-comment-nudge] Comment defines the code by what it is NOT or lacks.',
      '',
      `  Comment: ${finding.commentSnippet}`,
      `  Phrase:  "${finding.phrase}"`,
      '',
      '  Describe what the code IS, on its own terms. Never comment on what it is',
      '  not, what it lacks, or what it is not like — no "not a fork", "inspired by',
      '  X", "unlike Y", "no Z here". State the present identity; drop the negation.',
      '',
      '  Reminder-only; not a block.',
    ].join('\n')
  }
  if (finding.kind === 'temporal') {
    return [
      '[no-removal-comment-nudge] Comment narrates the past instead of the present.',
      '',
      `  Comment: ${finding.commentSnippet}`,
      `  Phrase:  "${finding.phrase}"`,
      '',
      '  Describe the current state — never what it "used to be" or "replaced".',
      '  The deprecated past is noise: the reader only needs the present truth.',
      '  Rewrite the comment to describe what the code does now, dropping the',
      '  reference to the removed/old thing (git log carries the history).',
      '',
      '  Reminder-only; not a block.',
    ].join('\n')
  }
  return [
    '[no-removal-comment-nudge] Relocation comment at a removal site.',
    '',
    `  Comment: ${finding.commentSnippet}`,
    `  Phrase:  "${finding.phrase}"`,
    '',
    '  A comment explaining where something moved belongs at the ADD site,',
    '  not where the code was removed. The reader at the removal site has',
    '  nothing to attach the comment to — it becomes orphaned noise.',
    '',
    '  Move the comment to wherever the replacement code/config lives,',
    '  or drop it entirely (git log carries the history).',
    '',
    '  Reminder-only; not a block.',
  ].join('\n')
}

export const check = editGuard((_filePath, _content, payload) => {
  // Only fires on Edit/MultiEdit — Write has no old/new distinction.
  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'MultiEdit') {
    return undefined
  }

  const input = payload.tool_input
  /* c8 ignore start - editGuard guarantees tool_input exists (file_path was resolved); unreachable in-process */
  if (!input) {
    return undefined
  }
  /* c8 ignore stop */

  let finding: RemovalCommentFinding | undefined

  if (tool === 'MultiEdit') {
    const edits = input.edits
    if (!Array.isArray(edits)) {
      return undefined
    }
    const typed: Array<{ old_string: string; new_string: string }> = []
    for (const e of edits) {
      if (
        e &&
        typeof e === 'object' &&
        typeof (e as { old_string?: unknown | undefined }).old_string ===
          'string' &&
        typeof (e as { new_string?: unknown | undefined }).new_string ===
          'string'
      ) {
        typed.push(e as { old_string: string; new_string: string })
      }
    }
    finding = detectRemovalCommentInEdits(typed)
  } else {
    const oldStr = input.old_string
    const newStr = input.new_string
    if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
      return undefined
    }
    finding = detectRemovalComment(oldStr, newStr)
  }

  if (!finding) {
    return undefined
  }
  return notify(buildMessage(finding))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
