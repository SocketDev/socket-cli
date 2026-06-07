#!/usr/bin/env node
// Claude Code Stop hook — yakback-reminder.
//
// Merges pure pattern-table tone reminders into one Stop-hook process:
// comment-tone + identifying-users + perfectionist + self-narration. Each
// is a `runStopReminder` data-table with no per-hook logic; running them as
// separate Stop processes is N stdin drains + N transcript reads for the
// same turn. This hook reads once and scans all groups via `runStopReminders`.
//
// NOT merged in: commit-pr-reminder (AI-attribution, backed by the
// shared _shared/ai-attribution.mts catalog — a different concern), and
// the blocking hooks dont-blame-reminder / excuse-detector, and the
// NLP hook judgment-reminder (real per-hook logic). Those stay separate.
//
// Informational; never blocks.

import { runStopReminders } from '../_shared/stop-reminder.mts'
import type { ReminderGroup } from '../_shared/stop-reminder.mts'

const COMMENT_TONE: ReminderGroup = {
  name: 'comment-yakback-reminder',
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
  closingHint:
    'These phrases in code comments age into noise. Per CLAUDE.md "Comments": audience is a junior dev — explain the constraint, the hidden invariant. Default to no comment.',
}

const IDENTIFYING_USERS: ReminderGroup = {
  name: 'identifying-users-reminder',
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
      regex:
        /\b[Tt]he\s+(?:developer|engineer)\s+(?:asked|needs|prefers|said|wants|wrote)\b/i,
      why: 'Same — name them if known, "you" if direct.',
    },
  ],
  closingHint:
    'CLAUDE.md "Identifying users": use the name from `git config user.name` when referencing what someone did or wants. Use "you/your" when speaking directly. "The user" reads as bureaucratic distance.',
}

const PERFECTIONIST: ReminderGroup = {
  name: 'perfectionist-reminder',
  patterns: [
    {
      label: 'option A (depth/correctness) … option B (speed/shipped)',
      regex:
        /\boption\s+a\b[^.?!\n]{0,80}\b(?:correctness|depth|proper|thorough)\b[\s\S]{0,200}\boption\s+b\b[^.?!\n]{0,80}\b(?:breadth|fast|ship|speed)\b/i,
      why: 'Speed-vs-depth choice menu. Per CLAUDE.md "Default to perfectionist when you have latitude" — pick depth and execute.',
    },
    {
      label: 'maximally useful vs maximally shipped',
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
      regex: /\b(?:depth\s+over\s+breadth|breadth\s+over\s+depth)\?/i,
      why: 'The CLAUDE.md default is depth (perfectionist). Pick it.',
    },
    {
      label: 'speed vs depth / fast vs right / now vs correct',
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
      regex:
        /\bplow\s+(?:ahead|through)\b[\s\S]{0,80}\b(?:carefully|correctly|properly|right)\b/i,
      why: 'Same pattern (velocity vs care). Default perfectionist.',
    },
  ],
  closingHint:
    'CLAUDE.md "Judgment & self-evaluation": "Default to perfectionist when you have latitude." If the user already gave perfectionist signals (asked for correctness, asked for depth, said "do it right"), do not re-present the choice — execute the perfectionist path.',
}

const SELF_NARRATION: ReminderGroup = {
  name: 'self-narration-reminder',
  patterns: [
    {
      label: 'unprompted status recap ("where things stand")',
      regex:
        /\b(?:here'?s|to recap|to summarize)\b[^.?!\n]{0,40}\b(?:where (?:things|we) (?:stand|are)|the state|stands?|recap|summary)\b/i,
      why: 'Mid-task status recap the user did not ask for. When mid-queue, keep working; surface status only when asked (CLAUDE.md "don\'t stop mid-queue").',
    },
    {
      label: 'self-narrating tool use ("now let me / let me just")',
      regex: /(?:^|\n)\s*(?:Now\s+)?[Ll]et me\s+(?:just\s+)?\b/,
      why: 'Narrating the next tool call adds no signal — make the call. Open on the result or the decision, not the intent.',
    },
    {
      label: 'BANNED word "honest" — hard rule, this match is a VERDICT not a heuristic',
      regex: /\bhonest(?:ly|y)?\b|\bin all honesty\b/i,
      why: 'Remove the word — honest / honestly / honesty / "in all honesty". This is a categorical user ban, NOT one of the over-firing heuristics below: a match here is always wrong, never a false positive. Claiming honesty implies the rest is not. State the fact, the limitation, or the recommendation plainly and delete the word.',
    },
    {
      label: 'conversational hedge ("to be fair / the reality is / be straight with you")',
      regex:
        /\bto be fair\b|\bthe reality is\b|\btruth be told\b|\bbe straight with you\b/i,
      why: 'Filler hedge that softens or pre-apologizes for a direct statement. Drop it and state the point plainly.',
    },
    {
      label: 'apology-padding ("you\'re absolutely right / my apologies")',
      regex:
        /\b(?:you'?re\s+(?:absolutely\s+)?right|my\s+apologies|sorry\s+about\s+that)\b/i,
      why: 'Reflexive agreement/apology padding. Acknowledge the correction by fixing it, not by performing contrition.',
    },
    {
      label: 'sugary enthusiasm padding ("great question / perfect / excellent / happy to")',
      regex:
        /\b(?:great\s+(?:question|point|idea|catch)|perfect[!.]|excellent[!.]|absolutely[!,]|happy\s+to|i'?d\s+be\s+(?:happy|glad)\s+to|sounds\s+(?:great|good)[!.])/i,
      why: 'Overly sugary filler. Be pleasant but plain — no enthusiasm performance. Get to the point.',
    },
  ],
  closingHint:
    'CLAUDE.md "Judgment & self-evaluation": direct imperatives get the tool call, not a tradeoff paragraph; finish queued work without mid-queue status padding. Address the user in a plain, direct voice — cut warm-up, hedges, and self-narration. EXCEPTION: the BANNED-word "honest" match is a hard rule, never a false positive — remove the word, do not dismiss it. The OTHER patterns are heuristic regexes that over-fire (a line-start "let me" mid-explanation, or a warranted "you\'re right" acknowledgment); for those, treat a match as a prompt to re-read the sentence, not a verdict.',
}

await runStopReminders([
  COMMENT_TONE,
  IDENTIFYING_USERS,
  PERFECTIONIST,
  SELF_NARRATION,
])
