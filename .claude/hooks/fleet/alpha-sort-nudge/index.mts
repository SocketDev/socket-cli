#!/usr/bin/env node
// Claude Code PreToolUse hook — alpha-sort-nudge.
//
// Nudges (never blocks) when an Edit/Write to a non-code file introduces a
// block of sibling items that looks unsorted. oxlint only sees JS/TS, so the
// `socket/sort-*` lint rules can't reach JSON / YAML / markdown / bash — this
// hook covers those surfaces per `docs/agents.md/fleet/sorting.md`:
//
//   - JSON / JSONC: runs of `"key":` lines at one indent, natural order.
//   - YAML: runs of `key:` mapping lines at one indent (env:/with:/matrix).
//   - Markdown: runs of `-`/`*` bullets; also flags trailing-ellipsis lines.
//   - Bash: runs of `NAME=...` assignments (cache-key var blocks).
//
// Detection is deliberately conservative: 3+ adjacent siblings at the same
// indent, natural order (case-insensitive + numeric-aware, lib's
// naturalCompare). False quiet beats false nag — a missed
// block is a review catch, a wrong nag trains the agent to ignore the hook.
// Returns a `notify` verdict (never blocks); the message is informational.
//

import path from 'node:path'

import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

export interface SortFinding {
  surface: 'json' | 'yaml' | 'markdown' | 'bash'
  hint: string
}

// Minimum sibling count before a run is worth flagging. Two-item runs carry
// too little signal (and are often guard pairs); 3+ is unambiguously a list.
const MIN_RUN = 3

// Fleet natural order (case-insensitive + numeric-aware, via lib's
// naturalCompare — the same comparator the socket/sort-* rules use). Returns
// true when already sorted.
function isAscadSorted(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i += 1) {
    if (naturalCompare(keys[i - 1]!, keys[i]!) > 0) {
      return false
    }
  }
  return true
}

// Leading-whitespace width of a line (spaces only; tabs count as one).
function indentOf(line: string): number {
  const m = line.match(/^(?<indent>\s*)/)
  /* c8 ignore next - regex always matches, fallback is unreachable */
  return m ? m.groups!.indent!.length : 0
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
  const m = line.match(/^\s*"(?<key>[^"]+)"\s*:/)
  return m ? m.groups?.key : undefined
}

// YAML mapping keys: `name:` at line start (not a `- ` sequence item, not a
// comment). Skips document markers and key-less lines.
function yamlKey(line: string): string | undefined {
  if (/^\s*#/.test(line) || /^\s*-/.test(line)) {
    return undefined
  }
  const m = line.match(/^\s*(?<key>[A-Za-z0-9_.-]+)\s*:(?:\s|$)/)
  return m ? m.groups?.key : undefined
}

// Markdown bullets: `- text` / `* text`. Returns the text after the marker.
function mdBullet(line: string): string | undefined {
  const m = line.match(/^\s*[-*]\s+(?<text>.*\S)\s*$/)
  if (!m) {
    return undefined
  }
  // Skip task-list checkboxes and nested numbered intent.
  return m.groups!.text!.toLowerCase()
}

// Bash all-caps assignments: `NAME=...` (cache-key var style).
function bashAssign(line: string): string | undefined {
  const m = line.match(/^\s*(?<name>[A-Z][A-Z0-9_]+)=/)
  return m ? m.groups?.name : undefined
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
  } else if (ext === '.yaml' || ext === '.yml') {
    scanRuns(lines, yamlKey, keys => {
      if (!isAscadSorted(keys)) {
        note(
          'yaml',
          `mapping keys out of order near: ${keys.slice(0, 4).join(', ')}…`,
        )
      }
    })
  } else if (ext === '.markdown' || ext === '.md') {
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

function buildMessage(
  filePath: string,
  findings: readonly SortFinding[],
): string {
  const lines = [
    `[alpha-sort-nudge] ${path.basename(filePath)} may have an unsorted list:`,
  ]
  for (const f of findings) {
    lines.push(`  • (${f.surface}) ${f.hint}`)
  }
  lines.push(
    '  Sort sibling items alphanumerically (natural order) unless order is load-bearing.',
    '  Fully re-sort the block when you touch it. See docs/agents.md/fleet/sorting.md.',
  )
  return lines.join('\n')
}

export const check = editGuard((filePath, content) => {
  // Write → full content; Edit → the replacement text (best-effort window).
  if (!content) {
    return undefined
  }
  const findings = findUnsortedBlocks(filePath, content)
  if (!findings.length) {
    return undefined
  }
  return notify(buildMessage(filePath, findings))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
