#!/usr/bin/env node
// Claude Code Stop hook — judgment-reminder.
//
// Flags hedging language in the assistant's most recent turn.
// CLAUDE.md "Judgment & self-evaluation":
//   - "If the request is based on a misconception, say so..."
//   - "Default to perfectionist when you have latitude."
//   - "If a fix fails twice: stop, re-read top-down..."
//
// Hedging ("I'm not sure", "you decide", "either approach works",
// modal "might/could/may") undermines those rules — it offloads the
// judgment back onto the user instead of executing the perfectionist
// default.
//
// What this catches:
//
//   - Fixed phrases (regex): "I'm not sure", "you decide", "either
//     approach works", "your call", "up to you", "let me know", etc.
//   - Modal verbs (compromise.js POS): could / might / may / perhaps /
//     maybe, when used as judgment hedges rather than technical
//     conditionals.
//
// The compromise.js NLP layer is what makes modal detection useful:
// "this could throw" (technical conditional, OK) vs "I could go either
// way" (judgment hedge, flag). The library tags each token with POS
// and lets us inspect the verb context. Regex alone gets too many
// false positives on the technical use.
//
// Fail-open contract: if compromise.js fails to load (or its data
// initializer throws), fall back to regex-only detection — the hook
// still flags fixed phrases, just misses the modal-verb signal.
//
// Disable via SOCKET_JUDGMENT_REMINDER_DISABLED.

import { runStopReminder } from '../_shared/stop-reminder.mts'
import type { ReminderHit, RuleViolation } from '../_shared/stop-reminder.mts'

// Try-require compromise.js for modal-verb detection. Lazy + optional
// because the dep is heavy (~2.5 MB unpacked) and the fixed-phrase
// regex catches the most common hedging patterns without it. Modal
// detection is an enhancement, not a requirement — if compromise is
// missing (e.g. downstream repo didn't pnpm install the hook's deps
// yet), the hook degrades gracefully to regex-only.
interface NlpDoc {
  readonly verbs: () => {
    readonly out: (mode: 'array') => readonly string[]
  }
  readonly sentences: () => {
    readonly out: (mode: 'array') => readonly string[]
  }
}
type NlpFn = (text: string) => NlpDoc

let cachedNlp: NlpFn | null | undefined
async function loadCompromise(): Promise<NlpFn | null> {
  if (cachedNlp !== undefined) {
    return cachedNlp
  }
  try {
    const mod = await import('compromise')
    const candidate = (mod as { default?: unknown }).default ?? mod
    cachedNlp = typeof candidate === 'function' ? (candidate as NlpFn) : null
  } catch {
    cachedNlp = null
  }
  return cachedNlp
}

// Sentence-starting hedge modals — "I could go either way", "this
// might be the better path", "perhaps we should..." These read as
// the assistant deferring judgment rather than stating a position.
//
// We filter to hedge contexts (first-person subject + modal + judgment
// verb) so technical conditionals like "the parser could throw if X"
// don't false-positive. The compromise pattern matches:
//   - (i|we) + (could|might|may)
//   - sentence-initial perhaps/maybe + we/I/it
const HEDGE_VERB_REGEX = /\b(i|we)\s+(could|might|may)\s+(go|do|try|use|pick|choose|approach|consider)\b/i

async function detectModalHedges(text: string): Promise<readonly ReminderHit[]> {
  const nlp = await loadCompromise()
  if (!nlp) {
    // Fallback: regex-only. We still catch the most common shape.
    const match = HEDGE_VERB_REGEX.exec(text)
    if (!match) {
      return []
    }
    return [{
      label: 'modal-verb hedge (regex fallback)',
      why: 'Modal verbs (could/might/may) used in first-person judgment context. State the position; don\'t hedge.',
      snippet: extractSnippet(text, match.index, match[0].length),
    }]
  }

  // Compromise.js path: walk sentences, flag any that contain a
  // first-person modal in a judgment context. The library tags each
  // verb with POS; we check sentence-by-sentence so the snippet is
  // useful (a single sentence rather than the whole turn).
  const doc = nlp(text)
  const sentences = doc.sentences().out('array')
  const hits: ReminderHit[] = []
  for (let i = 0, { length } = sentences; i < length; i += 1) {
    const sentence = sentences[i]!
    if (!HEDGE_VERB_REGEX.test(sentence)) {
      continue
    }
    // Compromise gives us POS-aware verb detection; we use it to
    // confirm the modal isn't part of a code-shape conditional like
    // "could throw" / "might return" (technical, not judgment).
    const sentenceDoc = nlp(sentence)
    const verbs = sentenceDoc.verbs().out('array')
    const hasJudgmentVerb = verbs.some(v =>
      /\b(go|do|try|use|pick|choose|approach|consider)\b/i.test(v),
    )
    if (!hasJudgmentVerb) {
      continue
    }
    hits.push({
      label: 'modal-verb hedge',
      why: 'First-person modal (could/might/may) used in judgment context. State the position; don\'t hedge.',
      snippet: sentence.length > 80 ? sentence.slice(0, 77) + '…' : sentence,
    })
    // One hit per turn is enough — flag and move on.
    break
  }
  return hits
}

function extractSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

const FIXED_HEDGE_PATTERNS: readonly RuleViolation[] = [
  {
    label: "I'm not sure / I am not sure",
    regex: /\bi['’]?m\s+not\s+sure\b|\bi\s+am\s+not\s+sure\b/i,
    why: 'Hedging. State a recommendation with rationale, or say "I need to verify X" and then do it.',
  },
  {
    label: 'you decide / your call / up to you',
    regex: /\b(you\s+decide|your\s+call|up\s+to\s+you)\b/i,
    why: 'Offloads judgment. Default-perfectionist: pick the recommended path and execute.',
  },
  {
    label: 'either approach works / either way works',
    regex: /\b(either\s+(approach|way|option|path)\s+works|either\s+is\s+fine)\b/i,
    why: 'False-equivalence hedging. Even when paths are close, name the one with the smaller blast radius and pick it.',
  },
  {
    label: 'let me know / your preference',
    regex: /\b(let\s+me\s+know|your\s+preference|tell\s+me\s+what)\b/i,
    why: 'Hand-off phrasing. If the user already gave intent, execute; if not, ask one specific question, not "let me know."',
  },
  {
    label: 'maybe / perhaps as judgment hedge',
    regex: /^(maybe|perhaps)\s+/im,
    why: 'Sentence-initial hedge. State the position; "maybe" at the front signals uncertainty the user didn\'t ask for.',
  },
]

await runStopReminder({
  name: 'judgment-reminder',
  disabledEnvVar: 'SOCKET_JUDGMENT_REMINDER_DISABLED',
  patterns: FIXED_HEDGE_PATTERNS,
  extraCheck: detectModalHedges,
  closingHint:
    'CLAUDE.md "Judgment & self-evaluation": default to perfectionist; state the recommendation, name the trade-off, then execute. Hedging asks the user to think for you.',
})
