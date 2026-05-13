#!/usr/bin/env node
// Claude Code Stop hook — compound-lessons-reminder.
//
// Flags assistant text that shows a repeat-finding pattern without
// evidence of promoting it to a rule. CLAUDE.md "Compound lessons
// into rules":
//
//   When the same kind of finding fires twice — across two runs,
//   two PRs, or two fleet repos — promote it to a rule instead of
//   fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*`
//   block, or a skill prompt — pick the lowest-friction surface.
//   Always cite the original incident in a `**Why:**` line.
//
// Detection:
//
//   1. Scan the assistant's prose for repeat-finding language: "again",
//      "second time", "same X as before", "we've seen this before",
//      "this is the third time", etc.
//
//   2. Inspect the same turn's tool-use events for evidence of
//      rule promotion: Edit/Write to CLAUDE.md, hooks/, or skills/.
//      Or for a `**Why:**` line in any written content (the canonical
//      shape for citing the original incident).
//
//   3. If a repeat-finding mention exists but no rule promotion
//      followed, warn.
//
// Disable via SOCKET_COMPOUND_LESSONS_REMINDER_DISABLED.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  readLastAssistantText,
  readLastAssistantToolUses,
  readStdin,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Probe common sibling locations for a wheelhouse checkout. Order is
// preference: socket-wheelhouse first (canonical), then aliases that
// appeared in the fleet historically. Returns the absolute path to
// template/CLAUDE.md if found, otherwise undefined.
function findWheelhouseClaudeMd(cwd: string): string | undefined {
  const candidates = [
    'socket-wheelhouse',
    'socket-repo-template', // legacy alias
  ]
  // Walk up from cwd: try ../<name>/template/CLAUDE.md at each parent.
  let dir = cwd
  for (let i = 0; i < 4; i += 1) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    for (let j = 0, { length } = candidates; j < length; j += 1) {
      const probe = path.join(parent, candidates[j]!, 'template', 'CLAUDE.md')
      if (existsSync(probe)) {
        return probe
      }
    }
    dir = parent
  }
  return undefined
}

interface StopPayload {
  readonly transcript_path?: string | undefined
}

const REPEAT_FINDING_PATTERNS: readonly { label: string; regex: RegExp }[] = [
  {
    label: 'again',
    regex: /\b(hit this )?again\b|\bonce more\b/i,
  },
  {
    label: 'second/third time',
    regex: /\b(second|third|fourth|fifth|nth|n-th) time\b/i,
  },
  {
    label: 'same X as before / before in this session',
    // Up to ~40 chars between "same" and "as/we saw" so we can match
    // "same monthCode resolution bug as we saw before" (multi-word X)
    // but not entire sentences.
    regex: /\bsame\s+[^.?!\n]{1,40}?\s+(as|we saw)\s+(before|earlier|previously|last time)\b/i,
  },
  {
    label: "we've seen this before",
    regex: /\b(we'?ve|i'?ve|we have|i have)\s+seen\s+this\s+(before|already)\b/i,
  },
  {
    label: 'recurring / keeps happening',
    regex: /\b(recurring|keeps happening|kept happening|repeated|repeating)\b/i,
  },
]

// Paths that signal rule promotion when edited in the same turn.
const RULE_SURFACE_PATTERNS: readonly RegExp[] = [
  /\bCLAUDE\.md\b/,
  /\/\.claude\/hooks\//,
  /\/\.claude\/skills\//,
  /\/template\/CLAUDE\.md\b/,
]

interface RepeatFindingHit {
  readonly label: string
  readonly snippet: string
}

function detectRepeatFindings(text: string): RepeatFindingHit[] {
  const stripped = stripCodeFences(text)
  const found: RepeatFindingHit[] = []
  for (let i = 0, { length } = REPEAT_FINDING_PATTERNS; i < length; i += 1) {
    const pattern = REPEAT_FINDING_PATTERNS[i]!
    const match = pattern.regex.exec(stripped)
    if (!match) {
      continue
    }
    const start = Math.max(0, match.index - 25)
    const end = Math.min(stripped.length, match.index + match[0].length + 40)
    const snippet = stripped.slice(start, end).replace(/\s+/g, ' ').trim()
    found.push({ label: pattern.label, snippet })
  }
  return found
}

function hasRulePromotionEvidence(
  toolUses: ReturnType<typeof readLastAssistantToolUses>,
  text: string,
): boolean {
  // Check 1: any Edit/Write to a rule surface.
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    const event = toolUses[i]!
    if (event.name !== 'Edit' && event.name !== 'Write') {
      continue
    }
    const filePath = event.input['file_path']
    if (typeof filePath !== 'string') {
      continue
    }
    for (let j = 0, { length: pLen } = RULE_SURFACE_PATTERNS; j < pLen; j += 1) {
      if (RULE_SURFACE_PATTERNS[j]!.test(filePath)) {
        return true
      }
    }
  }
  // Check 2: a `**Why:**` line in the assistant text (canonical citation
  // shape for new rules / memory entries).
  if (/\*\*Why:\*\*/.test(text)) {
    return true
  }
  return false
}

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_COMPOUND_LESSONS_REMINDER_DISABLED']) {
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
  const repeats = detectRepeatFindings(text)
  if (repeats.length === 0) {
    process.exit(0)
  }
  const toolUses = readLastAssistantToolUses(payload.transcript_path)
  if (hasRulePromotionEvidence(toolUses, text)) {
    process.exit(0)
  }

  const lines = [
    '[compound-lessons-reminder] Repeat finding detected without rule promotion:',
    '',
  ]
  for (let i = 0, { length } = repeats; i < length; i += 1) {
    const hit = repeats[i]!
    lines.push(`  • "${hit.label}" — …${hit.snippet}…`)
  }
  lines.push('')
  lines.push(
    '  CLAUDE.md "Compound lessons into rules": when the same kind of',
  )
  lines.push(
    '  finding fires twice, promote it to a rule. Land it in CLAUDE.md,',
  )
  lines.push(
    '  a `.claude/hooks/*` block, or a skill prompt — pick the lowest-',
  )
  lines.push(
    '  friction surface. Always cite the original incident in a',
  )
  lines.push('  `**Why:**` line.')
  lines.push('')
  // If the rule is fleet-wide (not just this repo), it belongs in
  // socket-wheelhouse/template/. Help the user find the right path
  // — or fall back to the PR link if the wheelhouse isn't local.
  const wheelhouseMd = findWheelhouseClaudeMd(process.cwd())
  if (wheelhouseMd) {
    lines.push(
      `  Fleet rule? Edit: ${wheelhouseMd}`,
    )
    lines.push(
      '  (Then re-cascade via `socket-wheelhouse/scripts/sync-scaffolding.mts`.)',
    )
  } else {
    lines.push(
      '  Fleet rule? Wheelhouse not found locally. Open a PR at',
    )
    lines.push(
      '    https://github.com/SocketDev/socket-wheelhouse',
    )
    lines.push(
      '  editing `template/CLAUDE.md` (or `template/.claude/hooks/`).',
    )
  }
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
