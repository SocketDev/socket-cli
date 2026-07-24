#!/usr/bin/env node
// Claude Code Stop hook — verify-absence-claims-nudge.
//
// Fires at turn-end. Scans the last assistant turn for an ABSENCE or PROVENANCE
// claim stated as fact — "there are no X", "X doesn't exist here", "X is
// vendored from Y", "that would land in <other repo>" — and reminds the agent
// to VALIDATE it before asserting: re-run the search WITHOUT path exclusions
// (the dir you excluded may be the one holding it) and check `git ls-files`.
//
// Why: a confident negative ("no wasm generators here; acorn is vendored from
// socket-lib") stated off a too-narrow grep — one that excluded the very tree
// holding the file — misleads the user and derails the task. An absence claim is
// only as good as the search behind it, and provenance is a read, not a guess;
// this nudge makes verification the precondition for the assertion.
//
// Verdict: notify (informational; never blocks — a Stop hook has no tool call to
// refuse). Code-fenced / inline-code text is ignored. Fail-open on any error.
//
// Rule: docs/agents.md/fleet/judgment-and-self-evaluation.md.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readLastAssistantText } from '../_shared/transcript.mts'

// Absence / non-existence / provenance-elsewhere claim shapes. Each pins a
// concrete assertion form so a bare "no" / "from" doesn't fire. Alternation
// branches are kept alphanumerically sorted (socket/sort-regex-alternations).
const ABSENCE_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  {
    label: 'no-such-thing',
    // "no <noun> exist/generators/scripts", or a leading "there are/is no".
    re: /\bno\s+[\w-]+\s+(?:exist|generators?|scripts?)\b|\bthere (?:are|is) no\b/i,
  },
  {
    label: 'not-present',
    // an is/do/does/are subject + a negation (" not" or a n't contraction) +
    // exist/found/here/present/tracked.
    re: /\b(?:are|do|does|is)(?: not|\s?n['’o]?t)\s+(?:exist|found|here|present|tracked)\b/i,
  },
  {
    label: 'provenance',
    // "comes (straight) from", "lives only in", "sourced from", "vendored from".
    re: /\b(?:comes? (?:straight )?from|lives? only in|sourced from|vendored from)\b/i,
  },
  {
    label: 'elsewhere',
    // "not in this repo", or "would land in <other repo>".
    re: /\bnot in this repo\b|\bwould land in\b/i,
  },
]

// Drop fenced + inline code so an example / quoted snippet doesn't trip the
// matcher (the claim we care about is prose, not a pasted command).
export function stripCode(text: string): string {
  // socket-lint: allow uncommented-regex -- fenced then inline code spans.
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '')
}

export function findAbsenceClaims(assistantText: string): string[] {
  const text = stripCode(assistantText)
  const hits: string[] = []
  for (let i = 0, { length } = ABSENCE_PATTERNS; i < length; i += 1) {
    const pattern = ABSENCE_PATTERNS[i]!
    if (pattern.re.test(text)) {
      hits.push(pattern.label)
    }
  }
  return hits
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const text = readLastAssistantText(payload?.transcript_path)
  if (!text) {
    return undefined
  }
  const hits = findAbsenceClaims(text)
  if (!hits.length) {
    return undefined
  }
  return notify(
    [
      '[verify-absence-claims-nudge] This turn states an absence / provenance claim as fact:',
      `  matched: ${hits.join(', ')}`,
      '',
      'Validate it before asserting — an absence claim is only as good as the search behind it:',
      '  - re-run the search with NO path exclusions (the dir you excluded may hold it);',
      '    a whole-tree `grep -rl <name>` and `git ls-files | grep <name>`, not a scoped one,',
      '  - confirm provenance by READING the file/generator, never by inferring it.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
