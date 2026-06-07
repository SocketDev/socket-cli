#!/usr/bin/env node
// Claude Code PreToolUse hook — alpha-sort-reminder.
//
// Nudges (never blocks) when an Edit/Write to a non-code file introduces a
// block of sibling items that looks unsorted. oxlint only sees JS/TS, so the
// `socket/sort-*` lint rules can't reach JSON / YAML / markdown / bash — this
// hook covers those surfaces per `docs/claude.md/fleet/sorting.md`:
//
//   - JSON / JSONC: runs of `"key":` lines at one indent, ASCII order.
//   - YAML: runs of `key:` mapping lines at one indent (env:/with:/matrix).
//   - Markdown: runs of `-`/`*` bullets; also flags trailing-ellipsis lines.
//   - Bash: runs of `NAME=...` assignments (cache-key var blocks).
//
// Detection is deliberately conservative: 3+ adjacent siblings at the same
// indent, and only ASCII-comparison. False quiet beats false nag — a missed
// block is a review catch, a wrong nag trains the agent to ignore the hook.
// Always exits 0; the message is informational on stderr.
//

import path from 'node:path'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?:
    | {
        content?: string | undefined
        file_path?: string | undefined
        new_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
}

export interface SortFinding {
  surface: 'json' | 'yaml' | 'markdown' | 'bash'
  hint: string
}

// Minimum sibling count before a run is worth flagging. Two-item runs carry
// too little signal (and are often guard pairs); 3+ is unambiguously a list.
const MIN_RUN = 3

// ASCII byte order, ascending. Returns true when already sorted.
function isAscadSorted(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i - 1]! > keys[i]!) {
      return false
    }
  }
  return true
}

// Leading-whitespace width of a line (spaces only; tabs count as one).
function indentOf(line: string): number {
  const m = line.match(/^(\s*)/)
  return m ? m[1]!.length : 0
}

// Walk lines, grouping maximal runs of lines that (a) match `keyFor` to a
// non-undefined key and (b) share the same indent as the run's first line.
// Calls back with each run's keys. Blank lines and non-matching lines break a
// run.
function scanRuns(
  lines: readonly string[],
  keyFor: (line: string) => string | undefined,
  onRun: (keys: string[]) => void,
): void {
  let runKeys: string[] = []
  let runIndent = -1
  const flush = () => {
    if (runKeys.length >= MIN_RUN) {
      onRun(runKeys)
    }
    runKeys = []
    runIndent = -1
  }
  for (const line of lines) {
    const key = keyFor(line)
    if (key === undefined) {
      flush()
      continue
    }
    const ind = indentOf(line)
    if (runKeys.length === 0) {
      runIndent = ind
      runKeys.push(key)
    } else if (ind === runIndent) {
      runKeys.push(key)
    } else {
      flush()
      runIndent = ind
      runKeys.push(key)
    }
  }
  flush()
}

// JSON / JSONC object keys: `"name": ...` (allow trailing comma).
function jsonKey(line: string): string | undefined {
  const m = line.match(/^\s*"([^"]+)"\s*:/)
  return m ? m[1] : undefined
}

// YAML mapping keys: `name:` at line start (not a `- ` sequence item, not a
// comment). Skips document markers and key-less lines.
function yamlKey(line: string): string | undefined {
  if (/^\s*#/.test(line) || /^\s*-/.test(line)) {
    return undefined
  }
  const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:(\s|$)/)
  return m ? m[1] : undefined
}

// Markdown bullets: `- text` / `* text`. Returns the text after the marker.
function mdBullet(line: string): string | undefined {
  const m = line.match(/^\s*[-*]\s+(.*\S)\s*$/)
  if (!m) {
    return undefined
  }
  // Skip task-list checkboxes and nested numbered intent.
  return m[1]!.toLowerCase()
}

// Bash all-caps assignments: `NAME=...` (cache-key var style).
function bashAssign(line: string): string | undefined {
  const m = line.match(/^\s*([A-Z][A-Z0-9_]+)=/)
  return m ? m[1] : undefined
}

/**
 * Inspect file content for likely-unsorted sibling blocks. Pure — no I/O.
 * Returns a finding per surface that looks unsorted (deduped by surface).
 */
export function findUnsortedBlocks(
  filePath: string,
  content: string,
): SortFinding[] {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath).toLowerCase()
  const lines = content.split('\n')
  const findings: SortFinding[] = []
  let pushed = false
  const note = (surface: SortFinding['surface'], hint: string) => {
    if (!pushed) {
      findings.push({ surface, hint })
      pushed = true
    }
  }

  if (ext === '.json' || ext === '.jsonc' || base === '.oxlintrc.json') {
    scanRuns(lines, jsonKey, keys => {
      if (!isAscadSorted(keys)) {
        note(
          'json',
          `object keys out of order near: ${keys.slice(0, 4).join(', ')}…`,
        )
      }
    })
  } else if (ext === '.yml' || ext === '.yaml') {
    scanRuns(lines, yamlKey, keys => {
      if (!isAscadSorted(keys)) {
        note(
          'yaml',
          `mapping keys out of order near: ${keys.slice(0, 4).join(', ')}…`,
        )
      }
    })
  } else if (ext === '.md' || ext === '.markdown') {
    scanRuns(lines, mdBullet, keys => {
      if (!isAscadSorted(keys)) {
        note(
          'markdown',
          `bullet list out of order near: ${keys.slice(0, 3).join('; ')}…`,
        )
      }
    })
    if (!pushed && /^\s*[-*]\s+.*(\.\.\.|…)\s*$/m.test(content)) {
      note(
        'markdown',
        'a bullet ends in an ellipsis — list every item or write "N items, see <source>"',
      )
    }
  } else if (ext === '.sh' || ext === '.bash' || base.endsWith('.bash')) {
    scanRuns(lines, bashAssign, keys => {
      if (!isAscadSorted(keys)) {
        note(
          'bash',
          `variable assignments out of order near: ${keys.slice(0, 4).join(', ')}…`,
        )
      }
    })
  }
  return findings
}

function emit(filePath: string, findings: readonly SortFinding[]): void {
  const lines = [
    `[alpha-sort-reminder] ${path.basename(filePath)} may have an unsorted list:`,
  ]
  for (const f of findings) {
    lines.push(`  • (${f.surface}) ${f.hint}`)
  }
  lines.push(
    '  Sort sibling items alphanumerically (ASCII order) unless order is load-bearing.',
    '  Fully re-sort the block when you touch it. See docs/claude.md/fleet/sorting.md.',
  )
  process.stderr.write(lines.join('\n') + '\n')
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
  if (!filePath) {
    return
  }
  // Write → full content; Edit → the replacement text (best-effort window).
  const content =
    payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
  if (!content) {
    return
  }
  const findings = findUnsortedBlocks(filePath, content)
  if (findings.length) {
    emit(filePath, findings)
  }
}

main().catch(e => {
  // Fail open — a reminder hook must never break a tool call.
  process.stderr.write(`[alpha-sort-reminder] skipped: ${String(e)}\n`)
})
