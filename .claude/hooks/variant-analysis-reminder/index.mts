#!/usr/bin/env node
// Claude Code Stop hook — variant-analysis-reminder.
//
// Flags High/Critical severity findings in the assistant's most-recent
// turn without subsequent evidence of grep/Glob/Read tool calls in
// the same turn. CLAUDE.md "Variant analysis on every High/Critical
// finding":
//
//   When a finding lands at severity High or Critical, search the
//   rest of the repo for the same shape before closing it. Bugs
//   cluster — same mental model, same antipattern. Three searches:
//   same file, sibling files, cross-package.
//
// Detection:
//
//   1. Scan the assistant's prose for "Critical"/"High" severity
//      mentions in finding-shaped context ("Critical: ...",
//      "Severity: High", "● High", etc.).
//
//   2. Inspect the same turn's tool-use events for evidence of
//      variant search: Grep, Glob, or Read calls. If at least one
//      search-shaped call ran AFTER the severity mention, the hook
//      is satisfied.
//
//   3. If a severity mention exists but no search followed, warn.
//
// This is a Stop hook so the user reads the warning alongside the
// turn's findings — next turn does the variant analysis.
//
// Disable via SOCKET_VARIANT_ANALYSIS_REMINDER_DISABLED.

import process from 'node:process'

import {
  readLastAssistantText,
  readLastAssistantToolUses,
  readStdin,
  stripCodeFences,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

// Severity mentions worth flagging. Each pattern matches a context
// where Critical/High is the finding's severity, not just a passing
// adjective. Case-sensitive on the severity word but tolerant of
// surrounding punctuation.
const SEVERITY_PATTERNS: readonly { label: string; regex: RegExp }[] = [
  {
    label: 'Critical/High severity label',
    regex: /\b(?:severity[:\s]+|grade[:\s]+|●\s*)?(Critical|High)\b(?=[:\s,])/g,
  },
  {
    label: 'CRITICAL/HIGH callout',
    regex: /(?<![A-Z])(CRITICAL|HIGH)(?![A-Z])\s*[:(]/g,
  },
]

// Tool-use names that count as "variant search."
const VARIANT_SEARCH_TOOLS: ReadonlySet<string> = new Set([
  'Grep',
  'Glob',
  'Read',
  'Agent', // delegated search is also variant analysis
])

interface DetectedSeverity {
  readonly term: string
  readonly snippet: string
}

function detectSeverityMentions(text: string): DetectedSeverity[] {
  const stripped = stripCodeFences(text)
  const found: DetectedSeverity[] = []
  for (let i = 0, { length } = SEVERITY_PATTERNS; i < length; i += 1) {
    const pattern = SEVERITY_PATTERNS[i]!
    pattern.regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(stripped)) !== null) {
      const term = match[1]!
      const start = Math.max(0, match.index - 20)
      const end = Math.min(stripped.length, match.index + match[0].length + 40)
      const snippet = stripped
        .slice(start, end)
        .replace(/\s+/g, ' ')
        .trim()
      found.push({ term, snippet })
      // Limit per pattern to avoid spam if every line says "High".
      if (found.length >= 3) {
        return found
      }
    }
  }
  return found
}

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_VARIANT_ANALYSIS_REMINDER_DISABLED']) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    process.exit(0)
  }
  const severityHits = detectSeverityMentions(text)
  if (severityHits.length === 0) {
    process.exit(0)
  }
  // Check the same turn's tool-uses for variant-search activity.
  const toolUses = readLastAssistantToolUses(payload.transcript_path)
  let searchCount = 0
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    if (VARIANT_SEARCH_TOOLS.has(toolUses[i]!.name)) {
      searchCount += 1
    }
  }
  if (searchCount >= 1) {
    // At least one variant search ran. We don't try to verify it was
    // about the right thing — that's the user's call. Hook satisfied.
    process.exit(0)
  }

  const lines = [
    '[variant-analysis-reminder] High/Critical severity flagged without follow-up search:',
    '',
  ]
  for (let i = 0, { length } = severityHits; i < length; i += 1) {
    const hit = severityHits[i]!
    lines.push(`  • ${hit.term}: …${hit.snippet}…`)
  }
  lines.push('')
  lines.push(
    '  CLAUDE.md "Variant analysis on every High/Critical finding":',
  )
  lines.push(
    '  Bugs cluster — same mental model, same antipattern. Three searches',
  )
  lines.push(
    '  before closing a High/Critical finding: same file, sibling files,',
  )
  lines.push(
    '  cross-package. The hook saw no Grep/Glob/Read/Agent in this turn.',
  )
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
