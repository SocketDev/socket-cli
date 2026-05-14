#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-md-section-size-guard.
//
// Complements `claude-md-size-guard` (40KB byte cap on the whole
// fleet block) by enforcing a per-section LINE cap inside the block.
// Without this, an Edit can grow a single rule from 2 lines into
// 20 paragraphs without ever tripping the byte cap — until enough
// other sections accrete that one tries to add 1 byte and breaks.
// The section cap forces the "outsource to docs/claude.md/fleet/<topic>.md"
// pattern at the moment a section is written, when the operator has
// the long-form text in hand.
//
// What the hook does:
//   1. Fires only on Edit/Write tool calls targeting a CLAUDE.md.
//   2. Materializes the post-edit content (full content for Write;
//      diff-applied for Edit; the new_string itself for partial Edit
//      when the file isn't readable).
//   3. Extracts the fleet block (between BEGIN/END markers).
//   4. Walks the fleet block by `### ` heading boundaries.
//   5. For each section, counts the body lines (lines after the
//      heading, up to the next `### ` or `END FLEET-CANONICAL` marker,
//      excluding blank lines at the very top of the section).
//   6. If any section's body exceeds the cap, exits 2 with a stderr
//      message naming the section + the cap + the canonical fix
//      (outsource to `docs/claude.md/fleet/<topic>.md` and replace
//      the section body with a one-sentence summary + link).
//
// Cap policy:
//   - Default: 8 body lines per `### ` section. (8 ≈ a tight rule
//     with 2 short paragraphs OR a rule + a "Why:" + a "How:" line.)
//   - Override via env `CLAUDE_MD_FLEET_SECTION_MAX_LINES`.
//   - Headings only inside the fleet block are checked. Per-repo
//     content (outside the markers) is uncapped — repo-specific
//     sections can be as long as they need to be.
//
// What counts as a "body line":
//   - Any non-blank line below the `### ` heading.
//   - Code-block lines (between ``` fences) count too. A long code
//     example pushes the section into the "outsource" regime same
//     as long prose.
//
// What's NOT a line:
//   - Blank lines (`\n` only, or whitespace-only).
//   - The heading itself.
//
// Why a section-level cap, not a hook on long lines:
//   The failure mode is "I wrote a 60-line rule because it's
//   conceptually one rule and the byte budget tolerated it." Per-
//   section line count catches this directly. Long lines are a
//   separate question (readability) and aren't constrained here.
//
// Hook contract:
//   - Reads PreToolUse JSON from stdin.
//   - Exits 0 (allowed), 2 (blocked + stderr explanation), or 0
//     with stderr log (fail-open on hook bugs).

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

// Default cap: 20 body lines. Chosen to accommodate the longest
// current fleet sections (~19 lines) without breaking the build,
// while still catching the failure mode where a single section grows
// to 30+ lines. Aspirational target is closer to 8 — sections above
// that have a long-form companion under docs/claude.md/fleet/, and
// the inline body is 1-2 sentences plus a link. Tighten the cap as
// long sections get outsourced.
const DEFAULT_MAX_BODY_LINES = 20
const FLEET_BEGIN_MARKER = '<!-- BEGIN FLEET-CANONICAL'
const FLEET_END_MARKER = '<!-- END FLEET-CANONICAL'

type ToolInput = {
  tool_input?:
    | {
        content?: string | undefined
        file_path?: string | undefined
        new_string?: string | undefined
        old_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
}

function isClaudeMd(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  const base = filePath.split('/').pop() ?? ''
  return base === 'CLAUDE.md'
}

function getMaxBodyLines(): number {
  const env = process.env['CLAUDE_MD_FLEET_SECTION_MAX_LINES']
  if (!env) {
    return DEFAULT_MAX_BODY_LINES
  }
  const n = Number.parseInt(env, 10)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_MAX_BODY_LINES
  }
  return n
}

/**
 * Apply an Edit's `old_string` → `new_string` substitution against
 * on-disk content. Returns the post-edit content, or undefined if
 * the substitution can't be applied cleanly (no match, multiple
 * matches without replace_all, or the file doesn't exist).
 */
function applyEditToFile(
  filePath: string,
  oldString: string | undefined,
  newString: string | undefined,
): string | undefined {
  if (!existsSync(filePath) || oldString === undefined || newString === undefined) {
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
  // If old_string occurs more than once, the Edit would have replace_all
  // or fail; either way we don't try to disambiguate here.
  if (onDisk.indexOf(oldString, idx + 1) !== -1) {
    return undefined
  }
  return onDisk.slice(0, idx) + newString + onDisk.slice(idx + oldString.length)
}

function extractFleetBlock(content: string): string | undefined {
  const beginIdx = content.indexOf(FLEET_BEGIN_MARKER)
  const endIdx = content.indexOf(FLEET_END_MARKER)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return undefined
  }
  return content.slice(beginIdx, endIdx)
}

interface SectionTooLong {
  heading: string
  bodyLineCount: number
  lineNumberInBlock: number
}

/**
 * Walk the fleet block and return any `### ` sections whose body
 * exceeds `maxBodyLines`. Sections are bounded by the next `### `
 * heading or by the end of the input. Headings at `##` or `#`
 * level are NOT inspected — only `### ` (third-level) since that's
 * the rule-level heading in the fleet block.
 */
function findTooLongSections(
  fleetBlock: string,
  maxBodyLines: number,
): SectionTooLong[] {
  const lines = fleetBlock.split('\n')
  const findings: SectionTooLong[] = []

  let currentHeading: string | undefined
  let currentHeadingLine = 0
  let bodyLineCount = 0

  function flushIfTooLong(): void {
    if (currentHeading !== undefined && bodyLineCount > maxBodyLines) {
      findings.push({
        heading: currentHeading,
        bodyLineCount,
        lineNumberInBlock: currentHeadingLine,
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.startsWith('### ')) {
      flushIfTooLong()
      currentHeading = line.slice(4).trim()
      currentHeadingLine = i + 1
      bodyLineCount = 0
    } else if (currentHeading !== undefined) {
      // Body line — count only non-blank ones.
      if (line.trim() !== '') {
        bodyLineCount += 1
      }
    }
  }
  flushIfTooLong()

  return findings
}

async function main(): Promise<number> {
  const raw = await readStdin()
  if (!raw.trim()) {
    return 0
  }

  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.stderr.write(
      'claude-md-section-size-guard: failed to parse stdin payload — fail-open\n',
    )
    return 0
  }

  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'Write') {
    return 0
  }

  const filePath = payload.tool_input?.file_path
  if (!isClaudeMd(filePath)) {
    return 0
  }

  // Materialize post-edit content.
  let postContent: string | undefined
  if (tool === 'Write') {
    postContent = payload.tool_input?.content
  } else {
    // Edit: try to apply the diff against on-disk content first.
    postContent =
      filePath !== undefined
        ? applyEditToFile(
            filePath,
            payload.tool_input?.old_string,
            payload.tool_input?.new_string,
          )
        : undefined
    // If diff-apply failed, fall back to scanning the new_string
    // alone — covers the case where on-disk is unreadable (test
    // harness, ephemeral file). This may give partial coverage.
    if (postContent === undefined) {
      postContent = payload.tool_input?.new_string
    }
  }

  if (!postContent) {
    return 0
  }

  const fleetBlock = extractFleetBlock(postContent)
  if (!fleetBlock) {
    // No markers — this isn't a fleet CLAUDE.md or the edit removed
    // them. Either way, this hook has nothing to check.
    return 0
  }

  const maxLines = getMaxBodyLines()
  const tooLong = findTooLongSections(fleetBlock, maxLines)
  if (tooLong.length === 0) {
    return 0
  }

  const lines: string[] = []
  lines.push(
    `🚨 claude-md-section-size-guard: blocked Edit/Write — fleet section(s) exceed cap.`,
  )
  lines.push(``)
  lines.push(`File:           ${filePath}`)
  lines.push(`Cap:            ${maxLines} body lines per ### section`)
  lines.push(``)
  for (const t of tooLong) {
    lines.push(
      `  ### ${t.heading} — ${t.bodyLineCount} body lines (${t.bodyLineCount - maxLines} over)`,
    )
  }
  lines.push(``)
  lines.push(`Why this cap exists:`)
  lines.push(`  The fleet block ships byte-identical to every socket-* repo`)
  lines.push(`  (12+ repos at last count). Every line is N copies of in-context`)
  lines.push(`  cost. Long sections are also harder to skim — the fleet block`)
  lines.push(`  is a reference card, not a tutorial.`)
  lines.push(``)
  lines.push(`Fix:`)
  lines.push(`  1. Pick the smallest faithful summary (1-2 sentences) of the`)
  lines.push(`     section's rule.`)
  lines.push(`  2. Move the long-form content (rationale, examples, edge cases)`)
  lines.push(`     into a new doc: docs/claude.md/fleet/<topic>.md (cascaded`)
  lines.push(`     via socket-wheelhouse — add the path to the sync manifest).`)
  lines.push(`  3. Replace the section body with the summary plus a markdown`)
  lines.push(`     link to the new doc:`)
  lines.push(`         Full rationale in [\`docs/claude.md/fleet/<topic>.md\`].`)
  lines.push(``)
  lines.push(`Override (rare; per-edit): set CLAUDE_MD_FLEET_SECTION_MAX_LINES`)
  lines.push(`in the environment before the edit.`)
  lines.push(``)
  process.stderr.write(lines.join('\n') + '\n')
  return 2
}

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(
      `claude-md-section-size-guard: hook error — fail-open: ${String(err)}\n`,
    )
    process.exit(0)
  },
)
