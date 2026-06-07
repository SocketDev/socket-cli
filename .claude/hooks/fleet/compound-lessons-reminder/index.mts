#!/usr/bin/env node
// Claude Code Stop hook — compound-lessons-reminder.
//
// Flags assistant text OR behavior that shows a repeat-finding pattern
// without evidence of promoting it to a rule. CLAUDE.md "Compound
// lessons into rules":
//
//   When the same kind of finding fires twice — across two runs,
//   two PRs, or two fleet repos — promote it to a rule instead of
//   fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*`
//   block, or a skill prompt — pick the lowest-friction surface.
//   Cite the motivating case in a `**Why:**` line generically, as a
//   timeless example — not a dated incident log.
//
// Detection (any signal fires the warning, missing rule-promotion
// evidence keeps it firing):
//
//   1. **Prose signal** — assistant's text contains repeat-finding
//      language: "again", "second time", "same X as before", "we've
//      seen this before", etc.
//
//   2. **Behavioral signal** — the current turn edits a fleet-canonical
//      file (hook / skill / lint rule / CLAUDE.md surface) that a
//      previous turn within the session also edited. Repeated edits to
//      the same surface, without a `**Why:**` line in the new content,
//      is the actual repeat-finding pattern — prose may or may not
//      mention it. Lookback: 5 prior assistant turns (cheap on long
//      transcripts, broad enough to catch "fix it again 4 turns later").
//
// Rule-promotion evidence (any one suppresses):
//
//   1. Edit/Write to a documented rule surface (CLAUDE.md, hooks/,
//      skills/, fleet lint rules) in the current turn.
//   2. A `**Why:**` line in the current turn's written content — the
//      canonical shape for citing the original incident.
//

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  readLastAssistantText,
  readLastAssistantToolUses,
  readPriorAssistantToolUses,
  readStdin,
  stripCodeFences,
} from '../_shared/transcript.mts'

// Probe common sibling locations for a wheelhouse checkout. Order is
// preference: socket-wheelhouse first (canonical), then aliases that
// appeared in the fleet historically. Returns the absolute path to
// template/CLAUDE.md if found, otherwise undefined.
export function findWheelhouseClaudeMd(cwd: string): string | undefined {
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

const REPEAT_FINDING_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> =
  [
    {
      label: 'again',
      regex: /\b(hit this )?again\b|\bonce more\b/i,
    },
    {
      label: 'second/third time',
      regex: /\b(fifth|fourth|n-th|nth|second|third) time\b/i,
    },
    {
      label: 'same X as before / before in this session',
      // Up to ~40 chars between "same" and "as/we saw" so we can match
      // "same monthCode resolution bug as we saw before" (multi-word X)
      // but not entire sentences.
      regex:
        /\bsame\s+[^.?!\n]{1,40}?\s+(as|we saw)\s+(before|earlier|previously|last time)\b/i,
    },
    {
      label: "we've seen this before",
      regex:
        /\b(we'?ve|i'?ve|we have|i have)\s+seen\s+this\s+(already|before)\b/i,
    },
    {
      label: 'recurring / keeps happening',
      regex:
        /\b(recurring|keeps happening|kept happening|repeated|repeating)\b/i,
    },
  ]

// Paths that signal rule promotion when edited in the same turn.
const RULE_SURFACE_PATTERNS: readonly RegExp[] = [
  /\bCLAUDE\.md\b/,
  /\/\.claude\/hooks\//,
  /\/\.claude\/skills\//,
  /\/template\/CLAUDE\.md\b/,
  /\/\.config\/fleet\/oxlint-plugin\/rules\//,
  /\/\.config\/fleet\/markdownlint-rules\//,
]

// Fleet-canonical file surfaces — when edited in the current turn AND a
// prior turn, that's a behavioral repeat-finding signal (the assistant is
// patching the same canonical surface twice, instead of promoting the
// underlying lesson to a rule). Broader than RULE_SURFACE_PATTERNS — also
// catches per-hook scripts, per-skill mts files, fleet scripts.
const FLEET_CANONICAL_FILE_PATTERNS: readonly RegExp[] = [
  /\bCLAUDE\.md\b/,
  /\/\.claude\/hooks\/fleet\//,
  /\/\.claude\/skills\/fleet\//,
  /\/\.claude\/agents\/fleet\//,
  /\/\.claude\/commands\/fleet\//,
  /\/\.config\/fleet\//,
  /\/scripts\/fleet\//,
  /\/docs\/claude\.md\/fleet\//,
]

function isFleetCanonicalPath(filePath: string): boolean {
  for (
    let i = 0, { length } = FLEET_CANONICAL_FILE_PATTERNS;
    i < length;
    i += 1
  ) {
    if (FLEET_CANONICAL_FILE_PATTERNS[i]!.test(filePath)) {
      return true
    }
  }
  return false
}

interface RepeatFindingHit {
  readonly label: string
  readonly snippet: string
}

interface RepeatEditHit {
  readonly path: string
}

/**
 * Behavioral signal: compare the current turn's Edit/Write paths against prior
 * turns' Edit/Write paths in the same session. Any path edited by both AND that
 * lives under a fleet-canonical surface is a repeat-edit hit. The assistant
 * patching the same hook / skill / CLAUDE.md surface twice is the actual
 * compound-lessons-into-rules trigger — prose may not mention it.
 *
 * Lookback (default 5) caps how far back to walk in prior assistant turns,
 * keeping the scan cheap on long transcripts.
 */
export function detectRepeatEdits(
  currentToolUses: ReturnType<typeof readLastAssistantToolUses>,
  priorToolUses: ReturnType<typeof readPriorAssistantToolUses>,
): RepeatEditHit[] {
  const currentPaths = new Set<string>()
  for (let i = 0, { length } = currentToolUses; i < length; i += 1) {
    const event = currentToolUses[i]!
    if (event.name !== 'Edit' && event.name !== 'Write') {
      continue
    }
    const filePath = event.input['file_path']
    if (typeof filePath !== 'string' || !isFleetCanonicalPath(filePath)) {
      continue
    }
    currentPaths.add(filePath)
  }
  if (currentPaths.size === 0) {
    return []
  }
  const hits: RepeatEditHit[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = priorToolUses; i < length; i += 1) {
    const event = priorToolUses[i]!
    if (event.name !== 'Edit' && event.name !== 'Write') {
      continue
    }
    const filePath = event.input['file_path']
    if (typeof filePath !== 'string' || !currentPaths.has(filePath)) {
      continue
    }
    if (seen.has(filePath)) {
      continue
    }
    seen.add(filePath)
    hits.push({ path: filePath })
  }
  return hits
}

export function detectRepeatFindings(text: string): RepeatFindingHit[] {
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

export function hasRulePromotionEvidence(
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
    for (
      let j = 0, { length: pLen } = RULE_SURFACE_PATTERNS;
      j < pLen;
      j += 1
    ) {
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
  // Prose signal: assistant text mentions repeat-finding language.
  const proseHits = detectRepeatFindings(text)
  // Behavioral signal: current turn edits a fleet-canonical surface
  // that a prior turn also edited (within the lookback window).
  const currentToolUses = readLastAssistantToolUses(payload.transcript_path)
  const priorToolUses = readPriorAssistantToolUses(payload.transcript_path, 5)
  const editHits = detectRepeatEdits(currentToolUses, priorToolUses)

  if (proseHits.length === 0 && editHits.length === 0) {
    process.exit(0)
  }
  // Rule-promotion check: suppress when there's evidence the assistant
  // is already promoting the lesson to a rule.
  //
  // For the *prose-only* signal, accept either the file-path heuristic
  // (Edit to CLAUDE.md / hooks/ / skills/) OR a `**Why:**` line.
  //
  // For the *behavioral* (repeat-edit) signal, the file-path heuristic
  // is incompatible — by definition the current turn is editing a rule-
  // surface file. So only a `**Why:**` line counts as suppression.
  // Otherwise editing the same hook twice in a row would self-suppress.
  const hasWhy = /\*\*Why:\*\*/.test(text)
  if (hasWhy) {
    process.exit(0)
  }
  if (
    editHits.length === 0 &&
    hasRulePromotionEvidence(currentToolUses, text)
  ) {
    process.exit(0)
  }

  const lines = [
    '[compound-lessons-reminder] Repeat finding detected without rule promotion:',
    '',
  ]
  for (let i = 0, { length } = proseHits; i < length; i += 1) {
    const hit = proseHits[i]!
    lines.push(`  • prose: "${hit.label}" — …${hit.snippet}…`)
  }
  for (let i = 0, { length } = editHits; i < length; i += 1) {
    const hit = editHits[i]!
    lines.push(`  • repeat-edit: ${hit.path}`)
  }
  lines.push('')
  lines.push('  CLAUDE.md "Compound lessons into rules": when the same kind of')
  lines.push(
    '  finding fires twice, promote it to a rule. Land it in CLAUDE.md,',
  )
  lines.push(
    '  a `.claude/hooks/*` block, or a skill prompt — pick the lowest-',
  )
  lines.push('  friction surface. Cite the motivating case in a `**Why:**`')
  lines.push('  line GENERICALLY, as a timeless example — not a dated incident')
  lines.push('  log (no dates / version deltas / percentages / SHAs).')
  lines.push('')
  // If the rule is fleet-wide (not just this repo), it belongs in
  // socket-wheelhouse/template/. Help the user find the right path
  // — or fall back to the PR link if the wheelhouse isn't local.
  const wheelhouseMd = findWheelhouseClaudeMd(process.cwd())
  if (wheelhouseMd) {
    lines.push(`  Fleet rule? Edit: ${wheelhouseMd}`)
    lines.push(
      '  (Then re-cascade via `socket-wheelhouse/scripts/sync-scaffolding.mts`.)',
    )
  } else {
    lines.push('  Fleet rule? Wheelhouse not found locally. Open a PR at')
    lines.push('    https://github.com/SocketDev/socket-wheelhouse')
    lines.push('  editing `template/CLAUDE.md` (or `template/.claude/hooks/`).')
  }
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
