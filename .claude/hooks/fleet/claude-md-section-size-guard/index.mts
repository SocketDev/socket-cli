#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-md-section-size-guard.
//
// Complements `claude-md-size-guard` (40KB byte cap on the whole
// fleet block) by enforcing a per-section LINE cap inside the block.
// Without this, an Edit can grow a single rule from 2 lines into
// 20 paragraphs without ever tripping the byte cap — until enough
// other sections accrete that one tries to add 1 byte and breaks.
// The section cap forces the "outsource to docs/agents.md/fleet/<topic>.md"
// pattern at the moment a section is written, when the operator has
// the long-form text in hand.
//
// What the hook does:
//   1. Fires only on Edit/Write tool calls targeting a CLAUDE.md.
//   2. Materializes the post-edit content (full content for Write;
//      diff-applied for Edit; the new_string itself for partial Edit
//      when the file isn't readable).
//   3. Extracts the fleet block (between the `<fleet-canonical>` markers).
//   4. Walks the fleet block by `### ` heading boundaries.
//   5. For each section, counts the body lines (lines after the
//      heading, up to the next `### ` or the `</fleet-canonical>` end
//      marker, excluding blank lines at the very top of the section).
//   6. If any section's body exceeds the cap, blocks with a stderr
//      message naming the section + the cap + the canonical fix
//      (outsource to `docs/agents.md/fleet/<topic>.md` and replace
//      the section body with a one-sentence summary + link).
//
// Cap policy (two metrics of one concern — "section too big"):
//   - BYTE cap: default 1500 body bytes per section. The line cap alone
//     misses the real bloat mode — a single 600-char one-liner is 1 line
//     but a big chunk of the 40KB whole-file budget that ships to every
//     fleet repo. The byte cap forces dense prose out to a docs page even
//     when it fits on few lines. Override via env
//     `CLAUDE_MD_FLEET_SECTION_MAX_BYTES`.
//   - LINE cap: default 12 body lines per `### ` section. A bullet-list
//     `Detail:` block (one line per linked doc) spends 3-6 lines, so the
//     cap is above the old prose-era 8. Override via env
//     `CLAUDE_MD_FLEET_SECTION_MAX_LINES`.
//   - A section is flagged when it exceeds EITHER cap; the message names
//     which one(s) and by how much.
//   - BOTH the fleet block AND the per-repo postamble (after the END
//     marker) are checked, with the same caps — a per-repo `### ` section
//     is held to the same terse-index shape (detail → docs/agents.md/repo/).
//     A CLAUDE.md with no fleet markers is treated as all-per-repo.
//
// What counts as a "body line" / "body byte":
//   - Any non-blank line below the `### ` heading (its UTF-8 byte length,
//     plus 1 for the newline, accrues to the section's byte total).
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
//   - A guard module: gate on Edit/Write of a CLAUDE.md, return
//     block() when a section exceeds either cap, undefined otherwise
//     (fail-open on hook bugs via runGuard).

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { extractFleetBlock, extractPerRepo } from '../_shared/fleet-markers.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export { extractFleetBlock, extractPerRepo }

// Default cap: 8 body lines. Sections above this should have a
// long-form companion under docs/agents.md/fleet/ and the inline body
// should shrink to 1-2 sentences plus a link. Catches the failure
// mode where a single section grows to 30+ lines while leaving room
// for short rules to stay self-contained.
const DEFAULT_MAX_BODY_BYTES = 1500
const DEFAULT_MAX_BODY_LINES = 12
// 75% of claude-md-size-guard's 40 KB whole-file cap. The fleet block ships
// byte-identical to every socket-* repo, so the bigger it grows the more it
// eats every member's budget — keep it under 75% so each repo's own section
// has room under the 40 KB total. Override via CLAUDE_MD_FLEET_BLOCK_MAX_BYTES.
const DEFAULT_FLEET_BLOCK_MAX_BYTES = 30 * 1024

/**
 * Apply an Edit's `old_string` → `new_string` substitution against on-disk
 * content. Returns the post-edit content, or undefined if the substitution
 * can't be applied cleanly (no match, multiple matches without replace_all, or
 * the file doesn't exist).
 */
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
  // If old_string occurs more than once, the Edit would have replace_all
  // or fail; either way we don't try to disambiguate here.
  if (onDisk.indexOf(oldString, idx + 1) !== -1) {
    return undefined
  }
  return onDisk.slice(0, idx) + newString + onDisk.slice(idx + oldString.length)
}

// Fleet-block byte size of the file as it exists ON DISK (pre-edit), or
// undefined when the file/block is unreadable. Lets the over-cap check tell a
// shrinking edit (remediation) apart from growth.
export function onDiskFleetBytes(filePath: string): number | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }
  let onDisk: string
  try {
    onDisk = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const blockText = extractFleetBlock(onDisk)
  return blockText ? Buffer.byteLength(blockText, 'utf8') : undefined
}

interface SectionTooLong {
  heading: string
  bodyLineCount: number
  bodyByteCount: number
  lineNumberInBlock: number
  // Which cap(s) the section exceeded — drives the message.
  overLines: boolean
  overBytes: boolean
}

/**
 * Walk the fleet block and return any `### ` sections whose body exceeds the
 * line cap OR the byte cap. Sections are bounded by the next `### ` heading or
 * by the end of the input. Headings at `##` or `#` level are NOT inspected —
 * only `### ` (third-level) since that's the rule-level heading in the fleet
 * block. Both metrics count only non-blank body lines; a body byte is the UTF-8
 * length of each counted line plus 1 for its newline.
 */
export function findTooLongSections(
  fleetBlock: string,
  maxBodyLines: number,
  maxBodyBytes: number,
): SectionTooLong[] {
  // The thin CLAUDE.md is a flat bullet index — each rule is ONE `- ` line, no
  // `### ` sections. The per-section line cap is moot (a bullet is one line);
  // `maxBodyLines` is kept for signature/back-compat but unused. The byte cap
  // is what matters: a bullet over `maxBodyBytes` carries inline detail that
  // belongs in its docs/agents.md/<topic>.md page. (40 KB whole-file cap stays,
  // enforced separately by claude-md-size-guard; this keeps each bullet terse.)
  void maxBodyLines
  const lines = fleetBlock.split('\n')
  const findings: SectionTooLong[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    /* c8 ignore next - String.prototype.split never yields undefined elements; TypeScript types the index as T|undefined */
    const line = lines[i] ?? ''
    if (!line.startsWith('- ')) {
      continue
    }
    const bytes = Buffer.byteLength(line, 'utf8') + 1
    if (bytes > maxBodyBytes) {
      findings.push({
        heading: line.slice(2).trim().slice(0, 60),
        bodyLineCount: 1,
        bodyByteCount: bytes,
        lineNumberInBlock: i + 1,
        overLines: false,
        overBytes: true,
      })
    }
  }
  return findings
}

export function getMaxBodyBytes(): number {
  const env = process.env['CLAUDE_MD_FLEET_SECTION_MAX_BYTES']
  if (!env) {
    return DEFAULT_MAX_BODY_BYTES
  }
  const n = Number.parseInt(env, 10)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_MAX_BODY_BYTES
  }
  return n
}

export function getMaxBodyLines(): number {
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

export function getFleetBlockMaxBytes(): number {
  const env = process.env['CLAUDE_MD_FLEET_BLOCK_MAX_BYTES']
  if (!env) {
    return DEFAULT_FLEET_BLOCK_MAX_BYTES
  }
  const n = Number.parseInt(env, 10)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_FLEET_BLOCK_MAX_BYTES
  }
  return n
}

export function isClaudeMd(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  /* c8 ignore next - split('/') on a non-empty string always yields a non-empty array; pop() never returns undefined */
  const base = normalizePath(filePath).split('/').pop() ?? ''
  return base === 'CLAUDE.md'
}

export const check = editGuard((filePath, content, payload) => {
  if (!isClaudeMd(filePath)) {
    return undefined
  }

  // Materialize post-edit content.
  const tool = payload.tool_name
  let postContent: string | undefined
  if (tool === 'Write') {
    postContent = content
  } else {
    // Edit: try to apply the diff against on-disk content first.
    const input = payload.tool_input
    const oldString =
      typeof input?.old_string === 'string' ? input.old_string : undefined
    const newString =
      typeof input?.new_string === 'string' ? input.new_string : undefined
    postContent = applyEditToFile(filePath, oldString, newString)
    // If diff-apply failed, fall back to scanning the new_string
    // alone — covers the case where on-disk is unreadable (test
    // harness, ephemeral file). This may give partial coverage.
    if (postContent === undefined) {
      postContent = newString
    }
  }

  if (!postContent) {
    return undefined
  }

  const fleetBlock = extractFleetBlock(postContent)
  // Fleet-block budget: the cascaded block ships byte-identical to every repo,
  // so it must stay minimal and leave each repo's own section room under the
  // 40 KB whole-file cap. Block when it eats past 75% of that budget.
  if (fleetBlock) {
    const fleetBytes = Buffer.byteLength(fleetBlock, 'utf8')
    const fleetMax = getFleetBlockMaxBytes()
    // A SHRINKING edit of an already-over-cap block is exactly the remediation
    // this guard's message asks for — let it through so the block can be
    // trimmed incrementally. Growth (or holding steady) while over stays
    // blocked, as does any edit that pushes an under-cap block over.
    const preFleetBytes = filePath ? onDiskFleetBytes(filePath) : undefined
    const shrinksOverCapBlock =
      preFleetBytes !== undefined &&
      preFleetBytes > fleetMax &&
      fleetBytes < preFleetBytes
    if (fleetBytes > fleetMax && !shrinksOverCapBlock) {
      return block(
        [
          '🚨 claude-md-section-size-guard: fleet block too large.',
          '',
          `File:        ${filePath}`,
          `Fleet block: ${fleetBytes} bytes — over the ${fleetMax}-byte cap`,
          `             (75% of the 40 KB whole-file limit) by ${fleetBytes - fleetMax}.`,
          '',
          '  The fleet block ships byte-identical to every socket-* repo and must',
          "  leave room for each repo's own section under the 40 KB total. Trim a",
          '  rule bullet to its 1-line invariant and move detail to its',
          '  docs/agents.md/fleet/<topic>.md page.',
          '',
          '  DOCTRINE: a full block is a TRIM signal, never a DEFER signal. When',
          '  promoting a rule, free room by trimming an existing bullet’s inline',
          '  detail into its doc — do NOT hold up (defer / down-scope) the new rule',
          '  because the block is at cap. Trimming an over-cap block is exempt',
          '  from this guard, so the trim + the promotion can land together.',
          '',
          '  Deterministic trim: `node scripts/fleet/trim-claude-md.mts --apply`',
          '  (also auto-runs in `pnpm run fix`) drops the last `; `-clause of the',
          '  fattest doc-linked bullet until the block fits — its detail already',
          '  lives in the linked doc.',
        ].join('\n'),
      )
    }
  }
  const maxLines = getMaxBodyLines()
  const maxBytes = getMaxBodyBytes()
  // Per-bullet terseness (generous; rarely fires now rules are one-line bullets).
  const tooLong: SectionTooLong[] = []
  if (fleetBlock) {
    tooLong.push(...findTooLongSections(fleetBlock, maxLines, maxBytes))
  }
  const perRepo = extractPerRepo(postContent)
  if (perRepo) {
    tooLong.push(...findTooLongSections(perRepo, maxLines, maxBytes))
  }
  if (tooLong.length === 0) {
    return undefined
  }

  const lines: string[] = []
  lines.push(
    `🚨 claude-md-section-size-guard: blocked Edit/Write — CLAUDE.md section(s) exceed cap.`,
  )
  lines.push(``)
  lines.push(`File:           ${filePath}`)
  void maxLines
  lines.push(`Cap:            ${maxBytes} bytes per rule bullet`)
  lines.push(``)
  for (let i = 0, { length } = tooLong; i < length; i += 1) {
    const t = tooLong[i]!
    const reasons: string[] = []
    /* c8 ignore start - overLines is always false and overBytes is always true; findTooLongSections only sets overBytes */
    if (t.overLines) {
      reasons.push(
        `${t.bodyLineCount} lines (${t.bodyLineCount - maxLines} over)`,
      )
    }
    /* c8 ignore stop */
    /* c8 ignore next - overBytes is always true; findTooLongSections only pushes findings with overBytes:true */
    if (t.overBytes) {
      reasons.push(
        `${t.bodyByteCount} bytes (${t.bodyByteCount - maxBytes} over)`,
      )
    }
    lines.push(`  - ${t.heading} — ${reasons.join(', ')}`)
  }
  lines.push(``)
  lines.push(`Why this cap exists:`)
  lines.push(`  The fleet block ships byte-identical to every socket-* repo`)
  lines.push(
    `  (12+ repos at last count). Every line is N copies of in-context`,
  )
  lines.push(`  cost. Long sections are also harder to skim — the fleet block`)
  lines.push(`  is a reference card, not a tutorial.`)
  lines.push(``)
  lines.push(`Fix:`)
  lines.push(`  1. Pick the smallest faithful summary (1-2 sentences) of the`)
  lines.push(`     section's rule.`)
  lines.push(
    `  2. Move the long-form content (rationale, examples, edge cases)`,
  )
  lines.push(`     into a new doc: docs/agents.md/fleet/<topic>.md (cascaded`)
  lines.push(`     via socket-wheelhouse — add the path to the sync manifest).`)
  lines.push(`  3. Replace the section body with the summary plus a markdown`)
  lines.push(`     link to the new doc:`)
  lines.push(
    `         Full rationale in [\`docs/agents.md/fleet/<topic>.md\`].`,
  )
  lines.push(``)
  lines.push(`Override (rare; per-edit): set CLAUDE_MD_FLEET_SECTION_MAX_LINES`)
  lines.push(`in the environment before the edit.`)
  lines.push(``)
  return block(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
