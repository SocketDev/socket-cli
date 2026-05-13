#!/usr/bin/env node
// Claude Code Stop hook — file-size-reminder.
//
// Surfaces file-size violations after Write / Edit / NotebookEdit
// tool calls. CLAUDE.md "File size":
//
//   Soft cap 500 lines, hard cap 1000 lines per source file. Past
//   those, split along natural seams — group by domain, not line
//   count; name files for what's in them; co-locate helpers with
//   consumers.
//
// Exceptions (also from CLAUDE.md / docs/claude.md/file-size.md):
//
//   - A single function that legitimately needs the space (the user
//     notes this inline at the top of the function).
//   - Generated artifacts (lockfiles, schema dumps, vendored data).
//
// The hook walks the most-recent assistant turn's tool-use events,
// finds Write/Edit/NotebookEdit calls, reads each target file from
// disk (post-edit state, since the hook fires after the tool ran),
// counts lines, and flags any file past either cap.
//
// Skips paths matching the generated-artifact heuristic — anything
// under common vendor / generated / dist / build / coverage paths.
// The skip list errs on the side of suppressing false positives;
// genuine in-scope files past the cap will still surface.
//
// Disable via SOCKET_FILE_SIZE_REMINDER_DISABLED.

import { existsSync, readFileSync, statSync } from 'node:fs'
import process from 'node:process'

import {
  readLastAssistantToolUses,
  readStdin,
} from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

const SOFT_CAP_LINES = 500
const HARD_CAP_LINES = 1000

// Tool names that write or modify file content. Read / Glob / Grep
// don't change a file, so they don't trigger this hook.
const FILE_WRITING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])

// Path patterns we skip — generated, vendored, or otherwise
// exempt from the cap. Tested as substring matches against the
// absolute file_path; a hit anywhere in the path skips the file.
//
// Each entry is intentionally generous: false-positives in the
// skip list are recoverable (the user can disable the hook or
// reduce the list), but false-positives in the *flagging* list
// would noise up every turn that touches a vendored file.
const SKIP_PATH_SUBSTRINGS: readonly string[] = [
  '/node_modules/',
  '/.cache/',
  '/coverage/',
  '/coverage-isolated/',
  '/dist/',
  '/build/',
  '/external/',
  '/vendor/',
  '/upstream/',
  '/.git/',
  '/test/fixtures/',
  '/test/packages/',
  // Lockfiles + manifests
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Cargo.lock',
  // Type declarations (often generated)
  '.d.ts',
  '.d.ts.map',
  '.tsbuildinfo',
  // Map files
  '.map',
]

interface SizeHit {
  readonly path: string
  readonly lines: number
  readonly cap: 'soft' | 'hard'
}

function isExempt(absPath: string): boolean {
  for (let i = 0, { length } = SKIP_PATH_SUBSTRINGS; i < length; i += 1) {
    if (absPath.includes(SKIP_PATH_SUBSTRINGS[i]!)) {
      return true
    }
  }
  return false
}

function countLines(absPath: string): number | undefined {
  try {
    if (!existsSync(absPath)) {
      return undefined
    }
    const stat = statSync(absPath)
    if (!stat.isFile()) {
      return undefined
    }
    // Use byte-count fast-path for very large files: if the file is
    // over ~256 KB it's almost certainly past the cap unless every
    // line is one byte (unrealistic). Otherwise read + count newlines.
    const content = readFileSync(absPath, 'utf8')
    // Count newlines + 1 unless the file is empty. This matches the
    // canonical `wc -l` convention (which counts newlines, off-by-one
    // for files without trailing newline) closely enough — exact
    // boundary cases at the cap edge don't matter, the cap is a
    // judgement guideline not a hard machine check.
    if (content.length === 0) {
      return 0
    }
    let count = 0
    for (let i = 0, { length } = content; i < length; i += 1) {
      if (content.charCodeAt(i) === 10) {
        count += 1
      }
    }
    // Add 1 for the final line if it doesn't end in a newline.
    if (content.charCodeAt(content.length - 1) !== 10) {
      count += 1
    }
    return count
  } catch {
    return undefined
  }
}

function collectHits(events: readonly { name: string; input: Record<string, unknown> }[]): SizeHit[] {
  const seen = new Set<string>()
  const hits: SizeHit[] = []
  for (let i = 0, { length } = events; i < length; i += 1) {
    const event = events[i]!
    if (!FILE_WRITING_TOOLS.has(event.name)) {
      continue
    }
    const pathField = event.input['file_path'] ?? event.input['notebook_path']
    if (typeof pathField !== 'string') {
      continue
    }
    if (seen.has(pathField)) {
      continue
    }
    seen.add(pathField)
    if (isExempt(pathField)) {
      continue
    }
    const lines = countLines(pathField)
    if (lines === undefined) {
      continue
    }
    if (lines > HARD_CAP_LINES) {
      hits.push({ path: pathField, lines, cap: 'hard' })
    } else if (lines > SOFT_CAP_LINES) {
      hits.push({ path: pathField, lines, cap: 'soft' })
    }
  }
  return hits
}

async function main(): Promise<void> {
  const payloadRaw = await readStdin()
  if (process.env['SOCKET_FILE_SIZE_REMINDER_DISABLED']) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }

  const events = readLastAssistantToolUses(payload.transcript_path)
  if (events.length === 0) {
    process.exit(0)
  }
  const hits = collectHits(events)
  if (hits.length === 0) {
    process.exit(0)
  }

  const lines = ['[file-size-reminder] File-size cap exceeded:', '']
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const hit = hits[i]!
    const capLabel = hit.cap === 'hard'
      ? `HARD CAP (${HARD_CAP_LINES} lines)`
      : `soft cap (${SOFT_CAP_LINES} lines)`
    lines.push(`  • ${hit.path}`)
    lines.push(`      ${hit.lines} lines — past ${capLabel}`)
  }
  lines.push('')
  lines.push(
    '  CLAUDE.md "File size": split along natural seams — group by domain,',
  )
  lines.push(
    '  name files for what\'s in them, co-locate helpers with consumers.',
  )
  lines.push(
    '  Exceptions (single legitimate large function / generated artifact)',
  )
  lines.push('  should be stated inline. Full playbook: docs/claude.md/file-size.md.')
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(0)
}

main().catch(() => {
  // Fail-open on any hook bug.
  process.exit(0)
})
