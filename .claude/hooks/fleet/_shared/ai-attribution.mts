/**
 * @file The fleet's single definition of "AI attribution". Every enforcer reads
 *   this module: the commit-message-format guard and commit-pr nudge (Claude
 *   tool layer), the no-commit / no-github attribution guards, the `commit-msg`
 *   and `pre-push` git hooks, the `strip-ai-attribution.mts` history rewriter,
 *   and the `check/commits-have-no-ai-attribution.mts` history gate. One
 *   catalog means a string blocked at one gate can never pass at another.
 *   Two matchers live here because they answer two different questions.
 *   `AI_ATTRIBUTION_PATTERNS` (and the `AI_ATTRIBUTION_RE` built from it) ask
 *   "does this text carry attribution boilerplate anywhere?" — the question a
 *   PR body, an MCP message, or a whole `git commit` command asks.
 *   `AI_COMMIT_ATTRIBUTION_PATTERNS` asks "is this specific line the trailer a
 *   public scanner fingerprints?" — a narrower, line-gated question that
 *   history scanning needs so a doc line quoting a trailer is not read as one.
 *   `stripAiAttribution` returns `{ cleaned, removed }`. The count is what the
 *   `commit-msg` hook reports to the operator, and a caller that only wants the
 *   text reads `.cleaned`.
 *   This module is GATE-FREE on purpose: it never imports
 *   `.git-hooks/_shared/helpers.mts` and carries no Node-version hard-exit, so
 *   a Claude hook can import it on the operator's possibly-older Node.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * One recognizable form of AI attribution: a human-readable `label`, the
 * `regex` that spots it, and the `why` a nudge shows the operator. Guards that
 * only need to name the hit read `label`.
 */
export interface AiAttributionPattern {
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

/**
 * Every attribution form the fleet blocks, ordered most specific first so the
 * label a guard reports is the sharpest one that fits. Bare product mentions
 * are deliberately absent: "Claude", "Claude Code", and `.claude/` are ordinary
 * prose and must not trip these. Only an attribution verb ("Generated with
 * …"), a hyphenated trailer key (`Co-Authored-By:` / `Assisted-by:` /
 * `Claude-Session:`, none of which occur in English prose), a vendor email
 * address, or the robot-emoji tag counts.
 */
export const AI_ATTRIBUTION_PATTERNS: readonly AiAttributionPattern[] = [
  {
    label: 'Generated with Claude/Anthropic',
    regex: /generated with (?:anthropic|claude)/i,
    why: 'The fleet forbids AI attribution in commit/PR text. Remove the line.',
  },
  {
    label: 'Co-Authored-By: Claude',
    regex: /co-authored-by:?\s*claude/i,
    why: 'Co-Authored-By Claude is forbidden in commit/PR trailers.',
  },
  {
    // The `<engine>:<model>` footer an agent writes into a PR summary
    // ("Assisted-by: Claude Code:opus-4-8") matches on its leading key +
    // vendor, so the model suffix never has to be enumerated.
    label: 'Assisted-by / Co-Authored-by: AI vendor',
    regex:
      /(?:Assisted|Co-Authored)[\s-]?by:?\s+(?:AI|Bard|ChatGPT|Claude|Copilot|Cursor|GPT|Gemini)/i,
    why: 'Trailer keys naming an AI vendor are forbidden in commit/PR text.',
  },
  {
    label: 'Authorship verb naming an AI vendor',
    regex:
      /(?:Authored|Built|Crafted|Created|Generated|Made|Powered|Written)\s+(?:by|with)\s+(?:AI|Bard|ChatGPT|Claude|Copilot|Cursor|GPT|Gemini)/i,
    why: 'Remove the "<verb> by/with <AI vendor>" attribution line.',
  },
  {
    // Bare emoji match (not `🤖.*generated`): the emoji alone is the
    // attribution signal, and a partial form must not slip past one gate
    // while failing the other.
    label: 'Robot emoji (🤖) tag line',
    regex: /🤖/,
    why: 'Remove the robot-emoji attribution line.',
  },
  {
    label: 'AI-generated / Machine-generated claim',
    regex: /(?:AI|Machine)[\s-]generated/i,
    why: 'Remove the "AI-generated" / "Machine-generated" attribution claim.',
  },
  {
    label: 'noreply@anthropic.com footer',
    regex: /<noreply@anthropic\.com>/i,
    why: 'Remove the noreply@anthropic.com attribution footer.',
  },
  {
    label: 'AI vendor email address',
    regex: /@(?:anthropic|openai)\.com/i,
    why: 'Remove the AI-vendor email address from the attribution line.',
  },
  {
    // The `Claude-Session:` trailer Claude Code auto-appends — a
    // `Key: value` git-trailer line carrying a session permalink. Match
    // the trailer key, anchored to its own line, OR the session-URL
    // shape, so a partial form can't slip past one gate while failing
    // another. The hyphenated `Claude-Session:` key never appears in
    // legitimate prose, so a sentence that merely names the tool and the
    // word "session" does not over-match.
    label: 'Claude-Session: trailer',
    regex: /^[ \t]*Claude-Session:|claude\.ai\/code\/session_/im,
    why: 'Remove the auto-appended Claude-Session trailer.',
  },
  {
    // A transcript byline pasted into a message. Anchored to line start so
    // "the assistant returned an error" mid-sentence stays clean.
    label: 'Assistant: transcript byline',
    regex: /^Assistant:/im,
    why: 'Remove the pasted "Assistant:" transcript byline.',
  },
]

/**
 * The whole-text matcher, built from `AI_ATTRIBUTION_PATTERNS` so the catalog
 * and the combined regex can never drift apart. Case-insensitive, and
 * multiline so the `^`-anchored trailer keys anchor per line rather than to the
 * start of the whole message. No `g` flag: a global regex carries `lastIndex`
 * state between `.test()` calls and would skip matches.
 */
export const AI_ATTRIBUTION_RE: RegExp = new RegExp(
  AI_ATTRIBUTION_PATTERNS.map(pattern => `(?:${pattern.regex.source})`).join(
    '|',
  ),
  'im',
)

/**
 * One line of AI attribution: a Co-authored-by/Generated-with/robot-emoji
 * trailer naming an AI assistant. Anchored per line; case-insensitive.
 */
export const AI_ATTRIBUTION_LINE_RE =
  /^\s*(?:(?:🤖\s*)?generated with\s+\[?(?:chatgpt|claude|copilot|cursor|gemini)|co-authored-by:.*(?:anthropic|chatgpt|claude|copilot|cursor|gemini|openai))/i

/**
 * A named commit-message fingerprint, the regex that recognizes it, and the
 * line-start gate that must pass before the regex is trusted. Every pattern
 * here targets a real trailer or tag line, not a sentence that merely mentions
 * one: `co-authored-by:.*aider` alone would also match a doc line like "the
 * scanner looks for co-authored-by: aider trailers", so `lineGate` requires
 * the candidate line to actually START with the trailer/tag shape before the
 * vendor-specific regex runs against that same line.
 */
export interface AiCommitAttributionPattern {
  readonly label: string
  readonly regex: RegExp
  readonly lineGate: RegExp
}

/**
 * A trailer/tag line starts with `Co-authored-by:` (optional leading
 * whitespace). Gates the twelve co-author entries below.
 */
export const TRAILER_LINE_GATE = /^\s*co-authored-by:/i

/**
 * A tag line starts with `Generated with`/`Generated by`, optionally behind a
 * leading robot emoji. Gates the three generated-with/by entries below.
 */
export const TAG_LINE_GATE = /^\s*(?:🤖\s*)?generated (?:by|with)\b/i

/**
 * A gate that always passes, for a pattern whose own regex already anchors to
 * the line start.
 */
export const ALWAYS_LINE_GATE = /^/

/**
 * The commit-message fingerprints public automation scanners look for. This
 * set mirrors the `AI_COMMIT_PATTERNS` list shipped by the `@unveil/identity`
 * detection engine, so a trailer the fleet leaves in history is the same
 * string a third party scores against the repo's contributors. Each entry
 * targets a vendor trailer or a generator tag line; none of them match a
 * human `Co-authored-by:`. The trailing `Fleet AI trailer` entry widens the
 * set to the fleet's own broader trailer shape (`AI_ATTRIBUTION_LINE_RE`), so
 * a vendor variant the fifteen scanner fingerprints miss — a non-anthropic.com
 * Claude address, `Generated with Gemini` — still gets caught; it runs last
 * so the scanner-specific label wins whenever both would match.
 */
export const AI_COMMIT_ATTRIBUTION_PATTERNS: readonly AiCommitAttributionPattern[] =
  [
    {
      label: 'Co-authored-by: @anthropic.com address',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*<[^>]*@anthropic\.com>/i,
    },
    {
      label: 'Co-authored-by: copilot@github.com address',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*<[^>]*copilot@github\.com>/i,
    },
    {
      label: 'Co-authored-by: +copilot@users.noreply.github.com address',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*<[^>]*\+copilot@users\.noreply\.github\.com>/i,
    },
    {
      label: 'Co-authored-by: GitHub Copilot',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:\s*github copilot\b/i,
    },
    {
      label: 'Co-authored-by: @cursor.com address',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*<[^>]*@cursor\.com>/i,
    },
    {
      label: 'Co-authored-by: devin-ai-integration',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*devin-ai-integration/i,
    },
    {
      label: 'Co-authored-by: Devin AI',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:\s*devin ai\b/i,
    },
    {
      label: 'Co-authored-by: @openai.com address',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*<[^>]*@openai\.com>/i,
    },
    {
      label: 'Co-authored-by: OpenAI Codex',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:\s*openai[- ]codex\b/i,
    },
    {
      label: 'Co-authored-by: aider',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:\s*aider\s*[(<]/i,
    },
    {
      label: 'Co-authored-by: openhands-agent',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*openhands-agent/i,
    },
    {
      label: 'Co-authored-by: @sourcegraph.com address',
      lineGate: TRAILER_LINE_GATE,
      regex: /co-authored-by:.*<[^>]*@sourcegraph\.com>/i,
    },
    {
      label: 'Generated with [Claude Code] tag line',
      lineGate: TAG_LINE_GATE,
      regex: /generated with \[?claude code/i,
    },
    {
      label: 'Robot-emoji generated-with tag line',
      lineGate: TAG_LINE_GATE,
      regex: /🤖 generated with/i,
    },
    {
      label: 'Generated by Cursor tag line',
      lineGate: TAG_LINE_GATE,
      regex: /generated by cursor/i,
    },
    {
      label: 'Fleet AI trailer',
      lineGate: ALWAYS_LINE_GATE,
      regex: AI_ATTRIBUTION_LINE_RE,
    },
  ]

/**
 * Branch-name prefixes minted by AI coding agents. A ref whose name starts
 * with one of these advertises the tool that opened it, which is both fleet
 * noise and a signal public scanners count.
 */
export const AI_BRANCH_PREFIXES: readonly string[] = [
  'aider/',
  'codex/',
  'copilot/',
  'devin/',
  'swe-agent/',
  'swe-bench/',
]

/**
 * True when a single line is AI attribution — a candidate line that passes a
 * pattern's `lineGate` and matches that pattern's vendor regex.
 */
export function isAiAttributionLine(line: string): boolean {
  for (
    let i = 0, { length } = AI_COMMIT_ATTRIBUTION_PATTERNS;
    i < length;
    i += 1
  ) {
    const pattern = AI_COMMIT_ATTRIBUTION_PATTERNS[i]!
    if (pattern.lineGate.test(line) && pattern.regex.test(line)) {
      return true
    }
  }
  return false
}

/**
 * A commit-message fingerprint match, naming the pattern that fired and the
 * exact line that fired it.
 */
export interface AiCommitAttributionMatch extends AiCommitAttributionPattern {
  readonly line: string
}

/**
 * The first scanner fingerprint a commit message matches, or undefined when
 * the message is clean. Tested line by line — never against the whole message
 * — so a `\s*` in a vendor regex cannot span a newline into an unrelated line,
 * and a `lineGate` failure keeps prose that merely mentions a trailer shape
 * (a doc line quoting `co-authored-by: aider`) from being misread as the
 * trailer itself. Reports the matched line directly, so a caller never has to
 * fall back to guessing which line fired.
 */
export function matchAiCommitAttribution(
  message: string,
): AiCommitAttributionMatch | undefined {
  const lines = message.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (
      let j = 0, { length: patternCount } = AI_COMMIT_ATTRIBUTION_PATTERNS;
      j < patternCount;
      j += 1
    ) {
      const pattern = AI_COMMIT_ATTRIBUTION_PATTERNS[j]!
      if (pattern.lineGate.test(line) && pattern.regex.test(line)) {
        return { ...pattern, line: line.trim() }
      }
    }
  }
  return undefined
}

/**
 * The branch name a git ref carries, with the plumbing wrappers removed:
 * `refs/heads/`, `refs/remotes/<remote>/`, `remotes/<remote>/`, and a bare
 * leading `origin/` all fall away, leaving `codex/foo` from every spelling of
 * that ref.
 */
export function normalizeBranchName(ref: string): string {
  return normalizePath(ref.trim())
    .replace(/^refs\/heads\//, '')
    .replace(/^(?:refs\/)?remotes\/[^/]+\//, '')
    .replace(/^origin\//, '')
}

/**
 * The AI-agent prefix a branch ref uses, or undefined when it uses none. The
 * match is a prefix match on the normalized name, so `fix/copilot-integration`
 * is clean while `copilot/fix-thing` is not.
 */
export function matchAiBranchPrefix(ref: string): string | undefined {
  const name = normalizeBranchName(ref).toLowerCase()
  for (let i = 0, { length } = AI_BRANCH_PREFIXES; i < length; i += 1) {
    const prefix = AI_BRANCH_PREFIXES[i]!
    if (name.startsWith(prefix)) {
      return prefix
    }
  }
  return undefined
}

/**
 * CRLF-tolerant line split, so a message written on Windows scans the same as
 * one written on macOS.
 */
function splitAttributionLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

/**
 * True when a line carries attribution under either matcher — the boilerplate
 * catalog or a scanner trailer fingerprint.
 */
function lineCarriesAttribution(line: string): boolean {
  return AI_ATTRIBUTION_RE.test(line) || isAiAttributionLine(line)
}

/**
 * True when a block of text carries attribution boilerplate anywhere in it.
 * This is the whole-text question: a PR body, an MCP tool input, a flattened
 * `git commit` command.
 */
export function containsAiAttribution(text: string): boolean {
  return AI_ATTRIBUTION_RE.test(text)
}

/**
 * True when any LINE of a commit message is attribution. Line-oriented (unlike
 * `containsAiAttribution`) and folds in the scanner trailer fingerprints, so it
 * agrees exactly with what `stripAiAttribution` would remove.
 */
export function hasAiAttribution(message: string): boolean {
  return splitAttributionLines(message).some(lineCarriesAttribution)
}

/**
 * A strip pass: the message with its attribution lines gone, and how many
 * lines were dropped.
 */
export interface AiAttributionStripResult {
  readonly cleaned: string
  readonly removed: number
}

/**
 * The message without its AI-attribution lines. When nothing matched, the
 * message comes back byte-for-byte. When lines were removed, the remainder is
 * normalized so it round-trips through git cleanly: the blank run a removed
 * block leaves collapses to one blank line, and the message ends with exactly
 * one newline.
 */
export function stripAiAttribution(message: string): AiAttributionStripResult {
  const lines = splitAttributionLines(message)
  const kept: string[] = []
  let removed = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (lineCarriesAttribution(line)) {
      removed += 1
    } else {
      kept.push(line)
    }
  }
  if (removed === 0) {
    return { cleaned: message, removed: 0 }
  }
  const collapsed = kept.join('\n').replace(/\n{3,}/g, '\n\n')
  return { cleaned: `${collapsed.replace(/\s+$/, '')}\n`, removed }
}
