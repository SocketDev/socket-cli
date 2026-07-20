#!/usr/bin/env node
// Claude Code PreToolUse hook — changelog-no-empty-guard.
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

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import {
  BYPASS_LOOKBACK_USER_TURNS,
  bypassPhrasePresent,
} from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow changelog-empty-section bypass'

/**
 * Keep-a-Changelog headings the rule recognizes. Custom subsection names (e.g.
 * `### Internal`) outside this set are left alone — the rule's job is to keep
 * the consumer-facing schema clean, not to police every heading shape
 * downstream chooses.
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
 * Find empty Keep-a-Changelog sections in CHANGELOG.md content. Returns an
 * array of { line, name } for each empty `### Section` heading. A section is
 * empty when the next non-blank line is either another `### ` heading, another
 * `## [` version heading, or EOF.
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
    /* c8 ignore start - existsSync passed; only fails under race/permission conditions */
    return undefined
    /* c8 ignore stop */
  }
  const idx = raw.indexOf(oldString)
  if (idx === -1) {
    return undefined
  }
  return raw.slice(0, idx) + newString + raw.slice(idx + oldString.length)
}

/**
 * Build the block message naming each empty section + the bypass phrase. Same
 * text the hook previously wrote to stderr (the runner appends the newline).
 */
export function buildBlockMessage(
  filePath: string,
  empty: Array<{ line: number; name: string }>,
): string {
  const lines: string[] = []
  lines.push('[changelog-no-empty-guard] Blocked: empty CHANGELOG section(s).')
  lines.push(`  File: ${filePath}`)
  lines.push('')
  for (const { line, name } of empty) {
    lines.push(`  Line ${line}: \`### ${name}\` has no bullets.`)
  }
  lines.push('')
  lines.push('  Per docs/agents.md/fleet/version-bumps.md §2, the CHANGELOG')
  lines.push('  is public/customer-facing only. When the filter leaves a')
  lines.push('  Keep-a-Changelog section empty, delete the heading too — a')
  lines.push('  reader scanning the release should not have to disambiguate')
  lines.push(
    '  "section intentionally empty" from "section forgot its content."',
  )
  lines.push('')
  lines.push(`  Bypass: type \`${BYPASS_PHRASE}\` in a recent message.`)
  return lines.join('\n')
}

export function isChangelog(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  const base = path.basename(filePath)
  return base === 'CHANGELOG.md'
}

export const check = editGuard((filePath, content, payload) => {
  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return undefined
  }
  if (!isChangelog(filePath)) {
    return undefined
  }
  const input = payload.tool_input
  const newString =
    typeof input?.new_string === 'string' ? input.new_string : undefined
  const oldString =
    typeof input?.old_string === 'string' ? input.old_string : undefined
  const postEdit = computePostEditText(
    toolName,
    filePath,
    newString,
    oldString,
    content,
  )
  if (postEdit === undefined) {
    return undefined
  }
  const empty = findEmptySections(postEdit)
  if (empty.length === 0) {
    return undefined
  }
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }
  return block(buildBlockMessage(filePath, empty))
})

export const hook = defineHook({
  bypass: ['changelog-empty-section'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
