#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-md-defer-detail-reminder.
//
// Sibling of claude-md-section-size-guard. That one caps section length
// after the fact (8 lines per `###`). This one fires earlier with a
// softer signal: when an Edit/Write adds a NEW `###` section to the
// fleet block whose body looks like detail (multi-line prose, lists,
// tables, `**Why:**` blocks, code fences) but contains NO link to a
// `docs/claude.md/{fleet,repo,wheelhouse}/<topic>.md` companion file,
// nudge the author to move the detail externally before the section
// hits the line cap.
//
// Heuristic — fires when ALL of:
//
//   1. The Edit/Write targets a CLAUDE.md (root or repo-specific).
//   2. The new content adds at least one NEW `### ` heading inside the
//      fleet block (BEGIN/END markers).
//   3. The new section's body contains ≥3 non-blank lines.
//   4. The new section has NO `docs/claude.md/{fleet,repo,wheelhouse}/`
//      link in its body.
//
// Why all four conditions:
//
//   - Per-section gate (not whole-file): a 2-line one-liner rule
//     doesn't need an external doc.
//   - "NEW section only": existing sections can grow without re-firing
//     the same reminder every edit. Triggered by a section heading the
//     pre-edit content didn't have.
//   - "≥3 body lines": cheap, robust. A rule that fits in 1-2 lines
//     IS the canonical inline form; only longer ones owe a link.
//   - "no docs/ link": the absence of a link is the actual signal —
//     the author has detail but hasn't externalized it.
//
// Never blocks (exit 0 always). Stop hooks can't refuse; PreToolUse
// CAN, but for "prefer to do X" guidance the right shape is a
// non-blocking stderr reminder. The companion claude-md-section-size-guard
// catches the hard-cap failure mode (8+ lines) with exit 2.
//

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { readStdin } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const FLEET_BEGIN_MARKER = '<!-- BEGIN FLEET-CANONICAL'
const FLEET_END_MARKER = '<!-- END FLEET-CANONICAL'
const MIN_BODY_LINES_FOR_REMINDER = 3
const DOCS_LINK_RE = /docs[/\\]claude\.md[/\\](?:fleet|repo|wheelhouse)[/\\]/

// ---------------------------------------------------------------------------
// Shared helpers (intentionally duplicated from claude-md-section-size-guard
// rather than imported — keeping each hook self-contained means a fleet
// repo missing one hook doesn't break the other at startup).
// ---------------------------------------------------------------------------

export function isClaudeMd(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  const base = filePath.split(/[/\\]/).pop() ?? ''
  return base === 'CLAUDE.md'
}

export function extractFleetBlock(content: string): string | undefined {
  const beginIdx = content.indexOf(FLEET_BEGIN_MARKER)
  const endIdx = content.indexOf(FLEET_END_MARKER)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return undefined
  }
  return content.slice(beginIdx, endIdx)
}

export function applyEditToFile(
  filePath: string,
  oldString: string | undefined,
  newString: string | undefined,
): string | undefined {
  if (
    !existsSync(filePath) ||
    oldString === undefined ||
    newString === undefined
  ) {
    return undefined
  }
  let onDisk: string
  try {
    onDisk = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const idx = onDisk.indexOf(oldString)
  if (idx === -1) {
    return undefined
  }
  if (onDisk.indexOf(oldString, idx + 1) !== -1) {
    return undefined
  }
  return onDisk.slice(0, idx) + newString + onDisk.slice(idx + oldString.length)
}

// ---------------------------------------------------------------------------
// Section diffing
// ---------------------------------------------------------------------------

interface Section {
  readonly heading: string
  readonly body: string
  readonly bodyLineCount: number
}

/**
 * Split a fleet block string into `### `-delimited sections. Each section
 * carries its heading text (without the leading `### `), body (everything
 * between the heading and the next `### ` or block end), and a count of
 * non-blank body lines.
 */
export function parseSections(fleetBlock: string): Section[] {
  const lines = fleetBlock.split('\n')
  const sections: Section[] = []
  let currentHeading: string | undefined
  let currentBodyLines: string[] = []
  let currentBodyLineCount = 0
  function flush(): void {
    if (currentHeading !== undefined) {
      sections.push({
        heading: currentHeading,
        body: currentBodyLines.join('\n'),
        bodyLineCount: currentBodyLineCount,
      })
    }
  }
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('### ')) {
      flush()
      currentHeading = line.slice(4).trim()
      currentBodyLines = []
      currentBodyLineCount = 0
    } else if (currentHeading !== undefined) {
      currentBodyLines.push(line)
      if (line.trim() !== '') {
        currentBodyLineCount += 1
      }
    }
  }
  flush()
  return sections
}

interface AddedSection {
  readonly heading: string
  readonly bodyLineCount: number
  readonly hasDocsLink: boolean
}

/**
 * Diff pre-edit vs post-edit fleet blocks and return sections whose heading is
 * NEW (didn't exist before this edit) AND whose body is long enough + lacks a
 * docs/claude.md/ link to merit the reminder.
 */
export function findAddedSectionsLackingLink(
  preContent: string | undefined,
  postContent: string,
): AddedSection[] {
  const postBlock = extractFleetBlock(postContent)
  if (!postBlock) {
    return []
  }
  const postSections = parseSections(postBlock)
  const preSections = preContent
    ? parseSections(extractFleetBlock(preContent) ?? '')
    : []
  const preHeadings = new Set(preSections.map(s => s.heading))
  const results: AddedSection[] = []
  for (let i = 0, { length } = postSections; i < length; i += 1) {
    const section = postSections[i]!
    if (preHeadings.has(section.heading)) {
      continue
    }
    if (section.bodyLineCount < MIN_BODY_LINES_FOR_REMINDER) {
      continue
    }
    const hasDocsLink = DOCS_LINK_RE.test(section.body)
    if (hasDocsLink) {
      continue
    }
    results.push({
      heading: section.heading,
      bodyLineCount: section.bodyLineCount,
      hasDocsLink,
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// CLI / payload glue
// ---------------------------------------------------------------------------

type ToolPayload = {
  tool_name?: string
  tool_input?: {
    file_path?: string
    content?: string
    old_string?: string
    new_string?: string
  }
}

function materializePostContent(payload: ToolPayload): {
  pre: string | undefined
  post: string | undefined
  filePath: string | undefined
} {
  const input = payload.tool_input ?? {}
  const filePath = input.file_path
  if (!filePath || !isClaudeMd(filePath)) {
    return { pre: undefined, post: undefined, filePath }
  }
  const tool = payload.tool_name
  if (tool === 'Write') {
    const pre = existsSync(filePath)
      ? (() => {
          try {
            return readFileSync(filePath, 'utf8')
          } catch {
            return undefined
          }
        })()
      : undefined
    return { pre, post: input.content, filePath }
  }
  if (tool === 'Edit' || tool === 'MultiEdit') {
    const pre = (() => {
      if (!existsSync(filePath)) {
        return undefined
      }
      try {
        return readFileSync(filePath, 'utf8')
      } catch {
        return undefined
      }
    })()
    const post = applyEditToFile(filePath, input.old_string, input.new_string)
    return { pre, post, filePath }
  }
  return { pre: undefined, post: undefined, filePath }
}

function emitReminder(filePath: string, added: readonly AddedSection[]): void {
  const lines: string[] = []
  lines.push(
    '[claude-md-defer-detail-reminder] CLAUDE.md is gaining detail without an external doc:',
  )
  lines.push('')
  lines.push(`  File: ${filePath}`)
  lines.push('')
  for (let i = 0, { length } = added; i < length; i += 1) {
    const s = added[i]!
    lines.push(
      `  ### ${s.heading} — ${s.bodyLineCount} body lines, no docs/ link`,
    )
  }
  lines.push('')
  lines.push('  CLAUDE.md is the fleet rulebook; long-form expansion goes in')
  lines.push(
    '  `docs/claude.md/fleet/<topic>.md` (or `docs/claude.md/repo/<topic>.md`',
  )
  lines.push(
    '  for repo-specific detail). Keep the rule + one-line "Why:" inline,',
  )
  lines.push('  link to the expansion. Example:')
  lines.push('')
  lines.push(
    '    🚨 Rule statement. **Why:** one-line incident. Bypass: `Allow X bypass`.',
  )
  lines.push(
    '    Spec: [`docs/claude.md/fleet/<topic>.md`](docs/claude.md/fleet/<topic>.md)',
  )
  lines.push('    (`.claude/hooks/fleet/<name>/`).')
  lines.push('')
  lines.push(
    '  This is a soft reminder — the edit proceeds. (The hard 8-line cap',
  )
  lines.push('  per section is enforced by `claude-md-section-size-guard`.)')
  logger.warn(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: ToolPayload
  try {
    payload = JSON.parse(raw) as ToolPayload
  } catch {
    return
  }
  if (
    payload.tool_name !== 'Edit' &&
    payload.tool_name !== 'Write' &&
    payload.tool_name !== 'MultiEdit'
  ) {
    return
  }
  const { pre, post, filePath } = materializePostContent(payload)
  if (!post || !filePath) {
    return
  }
  const added = findAddedSectionsLackingLink(pre, post)
  if (added.length === 0) {
    return
  }
  emitReminder(filePath, added)
  // Never block — informational only.
  process.exitCode = 0
}

if (process.argv[1]?.endsWith('index.mts')) {
  main().catch(() => {
    process.exitCode = 0
  })
}
