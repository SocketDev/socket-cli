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

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'

const logger = getDefaultLogger()

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
const REMOVAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // CSS class selector: `.foo-bar` (with hyphen — bare `.foo` matches
  // too many things)
  { name: 'CSS class', re: /\.[a-z][a-zA-Z0-9-]*-[a-zA-Z0-9-]+/g },
  // HTML attribute literal: `data-foo`, `aria-bar`
  { name: 'HTML attribute', re: /\b(?:aria|data)-[a-zA-Z0-9-]+/g },
  // Named export: `export const foo = ...` / `export function foo`
  {
    name: 'named export',
    re: /\bexport\s+(?:class|const|function|let|var)\s+(\w+)/g,
  },
]

export function findConsumerDirs(repoRoot: string): string[] {
  const found: string[] = []
  for (let i = 0, { length } = CONSUMER_DIRS; i < length; i += 1) {
    const dir = CONSUMER_DIRS[i]!
    if (existsSync(path.join(repoRoot, dir))) {
      found.push(dir)
    }
  }
  return found
}

export function findRemovedTokens(
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

export function findRepoRoot(
  filePath: string,
  cwd: string | undefined,
): string {
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

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// and fail-open on any throw. Reminder-only: it logs and returns without
// setting an exit code, so the Edit always proceeds.
await withEditGuard((filePath, _content, payload) => {
  // Only fires on Edit — Write is "create new file" semantically,
  // not "delete things."
  if (payload.tool_name !== 'Edit') {
    return
  }
  const input = payload.tool_input
  const oldStr = typeof input?.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input?.new_string === 'string' ? input.new_string : ''
  if (!oldStr || oldStr === newStr) {
    return
  }

  const removed = findRemovedTokens(oldStr, newStr)
  if (removed.size === 0) {
    return
  }

  const repoRoot = findRepoRoot(filePath, payload.cwd)
  const dirs = findConsumerDirs(repoRoot)
  if (dirs.length === 0) {
    return
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
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const d = dirs[i]!
    lines.push(`    ${d}/`)
  }
  lines.push('')
  lines.push(
    '  Past incident: agent stripped a CSS class because repo-root grep',
  )
  lines.push('  found 0 hits; an upstream bundle hydrated from it and the page')
  lines.push('  went blank. Grep every consumer subtree before continuing:')
  lines.push('')
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const d = dirs[i]!
    lines.push(
      `    rg -nF '${[...removed.values()].flat()[0] ?? '<token>'}' ${d}/`,
    )
  }
  lines.push('')
  lines.push('  Reminder-only; not a block.')
  lines.push('')

  logger.error(lines.join('\n'))
})
