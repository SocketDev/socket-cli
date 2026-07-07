#!/usr/bin/env node
// Claude Code Stop hook — yakback-nudge.
//
// Merges pure pattern-table tone reminders into one Stop-hook process:
// comment-tone + identifying-users + perfectionist + self-narration. Each
// is a `runStopReminder` data-table with no per-hook logic; running them as
// separate Stop processes is N stdin drains + N transcript reads for the
// same turn. This hook reads once and scans all groups in one `check`.
//
// NOT merged in: commit-pr-nudge (AI-attribution, backed by the
// shared _shared/ai-attribution.mts catalog — a different concern), and
// the blocking hooks dont-blame-nudge / excuse-detector, and the
// NLP hook judgment-nudge (real per-hook logic). Those stay separate.
//
// Informational; never blocks.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  HONESTY_FRAMING_RE,
  HONESTY_LABEL,
  HONESTY_WHY,
} from '../_shared/honesty-framing.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import {
  formatReminderBlock,
  scanReminderText,
} from '../_shared/stop-nudge.mts'
import type { ReminderGroup } from '../_shared/stop-nudge.mts'
import {
  readLastAssistantText,
  stripCodeFences,
  stripQuotedSpans,
} from '../_shared/transcript.mts'

const COMMENT_TONE: ReminderGroup = {
  closingHint:
    'These phrases in code comments age into noise. Per CLAUDE.md "Comments": audience is a junior dev — explain the constraint, the hidden invariant. Default to no comment.',
  name: 'comment-yakback-nudge',
  patterns: [
    {
      label: 'first, we (will|are)',
      regex: /\bfirst,? we (?:are|need|should|will)\b/i,
      why: 'Teacher-tone narration. Drop the step-by-step framing in comments.',
    },
    {
      label: 'note that',
      regex: /\bnote that\b/i,
      why: 'Tutorial filler. If the note is load-bearing, state it directly without the preamble.',
    },
    {
      label: "it['’]?s important to",
      regex: /\bit'?s important to\b/i,
      why: "Teacher-tone. State the constraint, don't announce that it's important.",
    },
    {
      label: 'as you can see',
      regex: /\bas you can see\b/i,
      why: 'Presupposes reader engagement. Drop the phrase.',
    },
    {
      label: 'remember that',
      regex: /\bremember (?:that|to)\b/i,
      why: "Teacher-tone. The reader doesn't need to be reminded — state the rule.",
    },
    {
      label: 'in order to',
      regex: /\bin order to\b/i,
      why: 'Wordy. "To X" is sufficient unless contrasting with another path.',
    },
  ],
}

const IDENTIFYING_USERS: ReminderGroup = {
  closingHint:
    'CLAUDE.md "Identifying users": use the name from `git config user.name` when referencing what someone did or wants. Use "you/your" when speaking directly. "The user" reads as bureaucratic distance.',
  name: 'identifying-users-nudge',
  patterns: [
    {
      label: 'the user wants/needs/asked/said',
      regex:
        /\b[Tt]he\s+user\s+(?:asked|chose|decided|likes|needs|picked|prefers|requested|said|wants|wrote)\b/i,
      why: 'Refers to a specific person\'s intent. Use their name from `git config user.name`, or "you" if speaking directly.',
    },
    {
      label: 'this user (singular reference)',
      regex: /\b[Tt]his\s+user\b/i,
      why: 'Same — naming or "you" is the right shape.',
    },
    {
      label: 'someone (singular human reference)',
      regex:
        /^Someone\s+(?:asked|needs|prefers|requested|said|wants|wrote)\b/im,
      why: '"Someone" hedges around naming. If you have access to git config, use the name.',
    },
    {
      label: 'the developer / the engineer (third-party framing)',
      // Matches "The developer asked/needs/..." and "The engineer said/wants/..." — two alternation groups for role + verb.
      regex:
        /\b[Tt]he\s+(?:developer|engineer)\s+(?:asked|needs|prefers|said|wants|wrote)\b/i,
      why: 'Same — name them if known, "you" if direct.',
    },
  ],
}

const PERFECTIONIST: ReminderGroup = {
  closingHint:
    'CLAUDE.md "Judgment & self-evaluation": "Default to perfectionist when you have latitude." If the user already gave perfectionist signals (asked for correctness, asked for depth, said "do it right"), do not re-present the choice — execute the perfectionist path.',
  name: 'perfectionist-nudge',
  patterns: [
    {
      label: 'option A (depth/correctness) … option B (speed/shipped)',
      // Matches "option A … correctness/depth/proper/thorough … option B … breadth/fast/ship/speed" with flexible inter-option prose; two quality/velocity alternation groups.
      regex:
        /\boption\s+a\b[^.?!\n]{0,80}\b(?:correctness|depth|proper|thorough)\b[\s\S]{0,200}\boption\s+b\b[^.?!\n]{0,80}\b(?:breadth|fast|ship|speed)\b/i,
      why: 'Speed-vs-depth choice menu. Per CLAUDE.md "Default to perfectionist when you have latitude" — pick depth and execute.',
    },
    {
      label: 'maximally useful vs maximally shipped',
      // Matches "maximally correct/thorough/useful … maximally fast/quick/shipped"; two quality/velocity alternation groups separated by up to 80 chars.
      regex:
        /\bmaximally\s+(?:correct|thorough|useful)\b[\s\S]{0,80}\bmaximally\s+(?:fast|quick|shipped)\b/i,
      why: 'Same pattern — re-litigating perfectionist-vs-velocity. User already chose perfectionist.',
    },
    {
      label: 'ship-it precision / ship-it-now',
      regex: /\bship[- ]it[- ]?(?:fast|now|precision|version)\b/i,
      why: 'Velocity-framed; CLAUDE.md says perfectionist default. Use unless user explicitly time-boxed.',
    },
    {
      label: 'depth over breadth / breadth over depth',
      // Matches "depth over breadth?" or "breadth over depth?"; alternation branches contain \s+ quantifiers, making the disjunction non-trivial.
      regex: /\b(?:depth\s+over\s+breadth|breadth\s+over\s+depth)\?/i,
      why: 'The CLAUDE.md default is depth (perfectionist). Pick it.',
    },
    {
      label: 'speed vs depth / fast vs right / now vs correct',
      // Matches "fast/now/quick/speed vs correct/depth/proper/right/thorough"; two alternation groups for velocity vs quality terms.
      regex:
        /\b(?:fast|now|quick|speed)\s+vs\.?\s+(?:correct|depth|proper|right|thorough)\b/i,
      why: 'Same speed-vs-quality framing; perfectionist is the default unless user opted out.',
    },
    {
      label: 'if you say A … if you say B',
      regex: /\bif\s+you\s+say\s+a\b[\s\S]{0,200}\bif\s+you\s+say\s+b\b/i,
      why: 'Binary choice architecture — masquerades as helpful framing but offloads judgment to user.',
    },
    {
      label: 'plow through vs do it right',
      // Matches "plow ahead/through … carefully/correctly/properly/right"; two alternation groups for the velocity-vs-care framing.
      regex:
        /\bplow\s+(?:ahead|through)\b[\s\S]{0,80}\b(?:carefully|correctly|properly|right)\b/i,
      why: 'Same pattern (velocity vs care). Default perfectionist.',
    },
  ],
}

const SELF_NARRATION: ReminderGroup = {
  closingHint:
    'CLAUDE.md "Judgment & self-evaluation": direct imperatives get the tool call, not a tradeoff paragraph; finish queued work without mid-queue status padding. Address the user in a plain, direct voice — cut warm-up, hedges, and self-narration. EXCEPTION: the BANNED honesty-framing match is a hard rule, never a false positive — remove the word, do not dismiss it. The OTHER patterns are heuristic regexes that over-fire (a line-start "let me" mid-explanation, or a warranted "you\'re right" acknowledgment); for those, treat a match as a prompt to re-read the sentence, not a verdict.',
  name: 'self-narration-nudge',
  patterns: [
    {
      label: 'unprompted status recap ("where things stand")',
      // Matches "here's/to recap/to summarize … where things/we stand/are|the state|stands|recap|summary"; opener group, then nested location/state alternation groups.
      regex:
        /\b(?:here'?s|to recap|to summarize)\b[^.?!\n]{0,40}\b(?:where (?:things|we) (?:stand|are)|the state|stands?|recap|summary)\b/i,
      why: 'Mid-task status recap the user did not ask for. When mid-queue, keep working; surface status only when asked (CLAUDE.md "don\'t stop mid-queue").',
    },
    {
      label: 'self-narrating tool use ("now let me / let me just")',
      // Matches line-start "Now let me…" or "let me just…"; three non-capturing groups: line boundary, optional "Now", optional "just".
      regex: /(?:^|\n)\s*(?:Now\s+)?[Ll]et me\s+(?:just\s+)?\b/,
      why: 'Narrating the next tool call adds no signal — make the call. Open on the result or the decision, not the intent.',
    },
    {
      label:
        'virtue-narration opener ("let me be disciplined / to be thorough / be careful here")',
      // Matches diligence-theater openers: outer alternation of four phrase templates, each with inner alternation groups for the virtue adjective or directional qualifier.
      regex:
        /\b(?:let me be (?:disciplined|careful|honest|precise|rigorous|thorough|methodical)|to be (?:thorough|rigorous|careful|disciplined|precise|safe)|i'?ll be (?:careful|thorough|disciplined|rigorous)\s+here|let me (?:think (?:hard|carefully)|step back)(?:\s+(?:here|about|on))?)\b/i,
      why: "Diligence theater — performing rigor instead of doing it. Cut the preamble and do the careful thing; the work IS the evidence of care. (Chat analog of the prose skill's throat-clearing-opener ban.)",
    },
    {
      // The honesty matcher is the shared _shared/honesty-framing.mts source —
      // a categorical ban, NOT one of the over-firing heuristics below: a match
      // here is always wrong, never a false positive.
      label: HONESTY_LABEL,
      regex: HONESTY_FRAMING_RE,
      why: HONESTY_WHY,
    },
    {
      label:
        'conversational hedge ("to be fair / the reality is / be straight with you")',
      regex:
        /\bto be fair\b|\bthe reality is\b|\btruth be told\b|\bbe straight with you\b/i,
      why: 'Filler hedge that softens or pre-apologizes for a direct statement. Drop it and state the point plainly.',
    },
    {
      label: 'apology-padding ("you\'re absolutely right / my apologies")',
      // Matches apology-pad phrases; outer alternation group, inner optional "absolutely" group — branch 1 contains a quantified group making the disjunction non-trivial.
      regex:
        /\b(?:you'?re\s+(?:absolutely\s+)?right|my\s+apologies|sorry\s+about\s+that)\b/i,
      why: 'Reflexive agreement/apology padding. Acknowledge the correction by fixing it, not by performing contrition.',
    },
    {
      label:
        'sugary enthusiasm padding ("great question / perfect / excellent / happy to")',
      // Matches enthusiasm fillers: outer alternation group with several branches, inner alternation groups for the noun after "great" and for "happy|glad" and "great|good" — multiple nested structural groups.
      regex:
        /\b(?:great\s+(?:question|point|idea|catch)|perfect[!.]|excellent[!.]|absolutely[!,]|happy\s+to|i'?d\s+be\s+(?:happy|glad)\s+to|sounds\s+(?:great|good)[!.])/i,
      why: 'Overly sugary filler. Be pleasant but plain — no enthusiasm performance. Get to the point.',
    },
  ],
}

const GROUPS: readonly ReminderGroup[] = [
  COMMENT_TONE,
  IDENTIFYING_USERS,
  PERFECTIONIST,
  SELF_NARRATION,
]

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  const rawText = readLastAssistantText(payload.transcript_path)
  if (!rawText) {
    return undefined
  }
  const fencesStripped = stripCodeFences(rawText)
  const blocks: string[] = []
  for (let i = 0, { length } = GROUPS; i < length; i += 1) {
    const group = GROUPS[i]!
    /* c8 ignore start - no current group sets stripQuotedSpans; branch reserved for future groups */
    const text = group.stripQuotedSpans
      ? stripQuotedSpans(fencesStripped)
      : fencesStripped
    /* c8 ignore stop */
    // eslint-disable-next-line no-await-in-loop
    const hits = await scanReminderText(text, group.patterns)
    if (hits.length > 0) {
      blocks.push(formatReminderBlock(group.name, hits, group.closingHint))
    }
  }
  if (blocks.length === 0) {
    return undefined
  }
  return notify(blocks.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
