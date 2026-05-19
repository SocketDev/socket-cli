#!/usr/bin/env node
// Claude Code PreToolUse hook — consumer-grep-reminder.
//
// Reminder (not blocker) on Edit/Write operations that DELETE a CSS
// class, HTML attribute, element selector, or named export. The
// concern: when the repo has `upstream/`, `vendor/`, `third_party/`, or
// `external/` submodules / vendored trees, repo-root grep for "is
// anyone using this?" misses consumers that live inside the
// upstream/vendored bundle. Past incident: an agent stripped a CSS
// class because the repo-root grep found 0 hits; the project's upstream
// bundle hydrated from that class and the rendered output went blank.
//
// Reminder shape:
//   - Detect a removal of a class/attribute/selector pattern in the
//     Edit's old_string that doesn't reappear in new_string.
//   - Check whether the repo has any of the canonical "consumer-bearing"
//     submodule / vendored directories.
//   - If yes, emit a stderr reminder pointing at the dirs to grep
//     BEFORE deleting. Exit 0 (no block).
//
// This is reminder-only because the false-positive surface is real:
// not every CSS class removal is a hydration-target removal. The
// stderr message gives the agent the signal to verify; the agent's
// correct response is to grep before continuing, not to abort.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly old_string?: string | undefined
      }
    | undefined
  readonly cwd?: string | undefined
}

// Dirs that signal "this repo has consumers outside the repo root."
// Match the same set as the untracked-by-default rule.
const CONSUMER_DIRS = [
  'upstream',
  'vendor',
  'third_party',
  'external',
  'deps',
  'additions/source-patched',
]

// Patterns whose removal triggers the reminder. Conservative — only
// signals when the removed token is unambiguous (a quoted selector,
// a class/attribute literal, an exported name).
const REMOVAL_PATTERNS: { name: string; re: RegExp }[] = [
  // CSS class selector: `.foo-bar` (with hyphen — bare `.foo` matches
  // too many things)
  { name: 'CSS class', re: /\.[a-z][a-zA-Z0-9-]*-[a-zA-Z0-9-]+/g },
  // HTML attribute literal: `data-foo`, `aria-bar`
  { name: 'HTML attribute', re: /\b(?:data|aria)-[a-zA-Z0-9-]+/g },
  // Named export: `export const foo = ...` / `export function foo`
  {
    name: 'named export',
    re: /\bexport\s+(?:const|let|var|function|class)\s+(\w+)/g,
  },
]

function findRemovedTokens(
  oldStr: string,
  newStr: string,
): Map<string, string[]> {
  const removed = new Map<string, string[]>()
  for (const { name, re } of REMOVAL_PATTERNS) {
    re.lastIndex = 0
    const oldMatches = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(oldStr)) !== null) {
      oldMatches.add(m[0])
    }
    re.lastIndex = 0
    const newMatches = new Set<string>()
    while ((m = re.exec(newStr)) !== null) {
      newMatches.add(m[0])
    }
    const gone: string[] = []
    for (const v of oldMatches) {
      if (!newMatches.has(v)) {
        gone.push(v)
      }
    }
    if (gone.length > 0) {
      removed.set(name, gone)
    }
  }
  return removed
}

function findConsumerDirs(repoRoot: string): string[] {
  const found: string[] = []
  for (const dir of CONSUMER_DIRS) {
    if (existsSync(path.join(repoRoot, dir))) {
      found.push(dir)
    }
  }
  return found
}

function findRepoRoot(filePath: string, cwd: string | undefined): string {
  // Walk up from filePath until we find a .git directory; fall back to cwd.
  let dir = path.dirname(filePath)
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(dir, '.git'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return cwd ?? path.dirname(filePath)
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw) {
    process.exit(0)
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Edit') {
    // Only fires on Edit — Write is "create new file" semantically,
    // not "delete things."
    process.exit(0)
  }
  const input = payload.tool_input
  const filePath = input?.file_path
  if (!filePath) {
    process.exit(0)
  }
  const oldStr = input?.old_string ?? ''
  const newStr = input?.new_string ?? ''
  if (!oldStr || oldStr === newStr) {
    process.exit(0)
  }

  const removed = findRemovedTokens(oldStr, newStr)
  if (removed.size === 0) {
    process.exit(0)
  }

  const repoRoot = findRepoRoot(filePath, payload.cwd)
  const dirs = findConsumerDirs(repoRoot)
  if (dirs.length === 0) {
    process.exit(0)
  }

  const lines: string[] = []
  lines.push(
    '[consumer-grep-reminder] removed tokens — grep upstream consumers before relying on the change:',
  )
  lines.push('')
  for (const [name, tokens] of removed) {
    lines.push(
      `  ${name}: ${tokens
        .slice(0, 5)
        .map(t => `\`${t}\``)
        .join(
          ', ',
        )}${tokens.length > 5 ? `  (+${tokens.length - 5} more)` : ''}`,
    )
  }
  lines.push('')
  lines.push('  Repo has consumer-bearing subtree(s):')
  for (const d of dirs) {
    lines.push(`    ${d}/`)
  }
  lines.push('')
  lines.push(
    '  Past incident: agent stripped a CSS class because repo-root grep',
  )
  lines.push('  found 0 hits; an upstream bundle hydrated from it and the page')
  lines.push('  went blank. Grep every consumer subtree before continuing:')
  lines.push('')
  for (const d of dirs) {
    lines.push(
      `    rg -nF '${[...removed.values()].flat()[0] ?? '<token>'}' ${d}/`,
    )
  }
  lines.push('')
  lines.push('  Reminder-only; not a block.')
  lines.push('')

  process.stderr.write(lines.join('\n'))
  process.exit(0)
}

main().catch(e => {
  process.stderr.write(
    `[consumer-grep-reminder] hook error (allowing): ${(e as Error).message}\n`,
  )
})
