#!/usr/bin/env node
// Claude Code PreToolUse hook — markdown-filename-guard.
//
// Blocks Edit/Write tool calls that would create a markdown file
// with a non-canonical filename. Per the fleet's docs convention:
//
//   - Allowed everywhere: README.md, LICENSE.
//   - Allowed at root, docs/, .claude/ (top level only), or any
//     package root (a directory holding package.json — npm renders
//     these files from there): the conventional SCREAMING_CASE set
//     (AUTHORS, CHANGELOG, CLAUDE, CODE_OF_CONDUCT, CONTRIBUTING,
//     GOVERNANCE, MAINTAINERS, NOTICE, SECURITY, SUPPORT, etc.).
//   - Everything else must be lowercase-with-hyphens AND placed
//     under `docs/` or `.claude/` (at any depth).
//
// Why: SCREAMING_CASE doc filenames optimize for "noticeable in a
// repo root" but read as shouty + opaque inside body text and TOC
// links. Hyphenated lowercase reads naturally and matches every
// other slug-style identifier the fleet uses (URLs, CSS classes,
// CLI flags, package names). The narrow SCREAMING_CASE allowlist is
// the set GitHub renders specially — adding more would dilute the
// signal.
//
// The classification itself lives in `_shared/markdown-path.mts`, shared with
// the commit-time belt check `scripts/fleet/check/markdown-filenames-are-canonical.mts`;
// this hook catches violations earlier, at edit time, so the model gets
// immediate feedback when it picks a wrong name.
//
// Exit code 2 makes Claude Code refuse the tool call.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Fails open on hook bugs (exit 0 + stderr log).

import { existsSync } from 'node:fs'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { classifyMarkdownPath } from '../_shared/markdown-path.mts'
import type { Verdict } from '../_shared/markdown-path.mts'

export function emitBlock(filePath: string, verdict: Verdict): string {
  const lines: string[] = []
  lines.push('[markdown-filename-guard] Blocked: non-canonical doc filename.')
  lines.push(`  File:       ${filePath}`)
  if (verdict.message) {
    lines.push(`  Issue:      ${verdict.message}`)
  }
  if (verdict.suggestion) {
    lines.push(`  Suggestion: ${verdict.suggestion}`)
  }
  lines.push('')
  lines.push('  Fleet doc-filename rules:')
  lines.push('    - README.md / LICENSE — allowed anywhere.')
  lines.push(
    '    - SCREAMING_CASE allowlist (AUTHORS, CHANGELOG, CLAUDE, CONTRIBUTING,',
  )
  lines.push(
    '      GOVERNANCE, MAINTAINERS, NOTICE, README, SECURITY, SUPPORT, …) —',
  )
  lines.push('      allowed at root / docs/ / .claude/ (top level only).')
  lines.push(
    '    - Everything else: lowercase-with-hyphens, in docs/ or .claude/.',
  )
  return lines.join('\n') + '\n'
}

export const check = editGuard((filePath, content, payload) => {
  void content
  const verdict = classifyMarkdownPath(filePath)
  if (verdict.ok) {
    return undefined
  }
  // The fleet doc-filename convention only governs fleet repos — an external /
  // sibling clone (e.g. a GitHub wiki where `Home.md` is the page slug) owns
  // its own naming.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  // Only block CREATION of a new non-canonical name. Editing a file that
  // already exists on disk — whose name predates this rule and which we are
  // not renaming — must never be blocked.
  if (existsSync(filePath)) {
    return undefined
  }
  return block(emitBlock(filePath, verdict))
})

export const hook = defineHook({
  bypass: ['markdown-filename'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
