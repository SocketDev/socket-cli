#!/usr/bin/env node
// Claude Code PreToolUse hook — changelog-no-empty-sections-guard.
//
// Blocks Edit/Write tool calls that would land an empty
// `### <Keep-a-Changelog-section>` heading in `CHANGELOG.md`.
//
// Why: the version-bumps rule ("CHANGELOG public-facing only") tells
// the author to FILTER out internal commits. When the filter happens
// to leave a Keep-a-Changelog section (Added / Changed / Removed /
// Renamed / Fixed / Performance / Migration) with zero bullets, the
// heading should be deleted too. Leaving an empty heading makes the
// reader disambiguate "section intentionally empty" from "section
// forgot its content" — every release should communicate clearly.
//
// What counts as empty: a `### Section` line whose immediate next
// non-blank line is another heading (`### Section` / `## [`) — i.e.
// the section has no bullets before the next heading. Comments and
// blank lines between the heading and the next heading don't count.
//
// Bypass: type `Allow changelog-empty-section bypass` in a recent
// user turn. The hook reads the recent transcript for the phrase.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow changelog-empty-section bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

/**
 * Keep-a-Changelog headings the rule recognizes. Custom subsection
 * names (e.g. `### Internal`) outside this set are left alone — the
 * rule's job is to keep the consumer-facing schema clean, not to
 * police every heading shape downstream chooses.
 */
const SECTION_NAMES = new Set([
  'Added',
  'Changed',
  'Deprecated',
  'Fixed',
  'Migration',
  'Performance',
  'Removed',
  'Renamed',
  'Security',
])

/**
 * Find empty Keep-a-Changelog sections in CHANGELOG.md content.
 * Returns an array of { line, name } for each empty `### Section`
 * heading. A section is empty when the next non-blank line is either
 * another `### ` heading, another `## [` version heading, or EOF.
 */
export function findEmptySections(
  content: string,
): Array<{ line: number; name: string }> {
  const lines = content.split('\n')
  const empty: Array<{ line: number; name: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.startsWith('### ')) {
      continue
    }
    const name = line.slice(4).trim()
    if (!SECTION_NAMES.has(name)) {
      continue
    }
    // Scan forward for the next non-blank line.
    let nextNonBlank: string | undefined
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!
      if (next.trim() === '') {
        continue
      }
      nextNonBlank = next
      break
    }
    // Empty if next non-blank is a heading at the same or higher
    // level, or end-of-file.
    if (
      nextNonBlank === undefined ||
      nextNonBlank.startsWith('### ') ||
      nextNonBlank.startsWith('## ')
    ) {
      empty.push({ line: i + 1, name })
    }
  }
  return empty
}

/**
 * Compute the post-edit text. For Write, that's just `content`. For Edit,
 * splice the on-disk file: replace `old_string` with `new_string` once. If the
 * on-disk file isn't readable or `old_string` doesn't match exactly, return
 * undefined (caller fails open).
 */
export function computePostEditText(
  toolName: string,
  filePath: string,
  newString: string | undefined,
  oldString: string | undefined,
  content: string | undefined,
): string | undefined {
  if (toolName === 'Write') {
    return content
  }
  if (toolName !== 'Edit') {
    return undefined
  }
  if (!existsSync(filePath)) {
    return newString
  }
  if (oldString === undefined || newString === undefined) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const idx = raw.indexOf(oldString)
  if (idx === -1) {
    return undefined
  }
  return raw.slice(0, idx) + newString + raw.slice(idx + oldString.length)
}

export function emitBlock(
  filePath: string,
  empty: Array<{ line: number; name: string }>,
): void {
  const lines: string[] = []
  lines.push(
    '[changelog-no-empty-sections-guard] Blocked: empty CHANGELOG section(s).',
  )
  lines.push(`  File: ${filePath}`)
  lines.push('')
  for (const { line, name } of empty) {
    lines.push(`  Line ${line}: \`### ${name}\` has no bullets.`)
  }
  lines.push('')
  lines.push(
    "  Per docs/claude.md/fleet/version-bumps.md §2, the CHANGELOG",
  )
  lines.push('  is public/customer-facing only. When the filter leaves a')
  lines.push('  Keep-a-Changelog section empty, delete the heading too — a')
  lines.push('  reader scanning the release should not have to disambiguate')
  lines.push('  "section intentionally empty" from "section forgot its content."')
  lines.push('')
  lines.push(`  Bypass: type \`${BYPASS_PHRASE}\` in a recent message.`)
  process.stderr.write(lines.join('\n') + '\n')
}

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
  transcript_path?: string | undefined
}

export function isChangelog(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  const base = path.basename(filePath)
  return base === 'CHANGELOG.md'
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!isChangelog(filePath)) {
    return
  }
  const postEdit = computePostEditText(
    payload.tool_name,
    filePath,
    payload.tool_input?.new_string,
    payload.tool_input?.old_string,
    payload.tool_input?.content,
  )
  if (postEdit === undefined) {
    return
  }
  const empty = findEmptySections(postEdit)
  if (empty.length === 0) {
    return
  }
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return
  }
  emitBlock(filePath, empty)
  // Hard-exit on the block path so no later microtask / catch handler can
  // reset the code. The .catch below fails open (exit 0) on a genuine
  // hook error — that path must stay distinct from a real block.
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[changelog-no-empty-sections-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
