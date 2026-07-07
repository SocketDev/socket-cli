#!/usr/bin/env node
// Claude Code PreToolUse hook — vscode-folder-open-task-guard.
//
// Blocks Edit/Write/MultiEdit that introduces a VS Code task set to auto-run on
// folder open. A `.vscode/tasks.json` (or a `*.code-workspace` with an embedded
// `tasks` block) carrying:
//
//     "runOptions": { "runOn": "folderOpen" }
//
// executes the moment the folder is opened in VS Code — zero clicks, before the
// user reviews anything. It's a known drive-by / supply-chain RCE vector (a
// malicious dependency, a malicious PR, or a poisoned cascade can ship one) and
// a common infostealer dropper. Committing one into a fleet repo is never
// legitimate — auto-run-on-open is the smoking gun.
//
// `.vscode/` is also ignored fleet-wide (so a tasks.json normally can't be
// committed at all); this guard backstops an explicitly force-added one and
// catches a `*.code-workspace`, which the `.vscode/` ignore doesn't cover.
//
// Bypass: `Allow vscode-folder-open-task bypass` in a recent user turn (rare;
// e.g. authoring this guard's own test fixtures).
//
// Exit codes: 0 — pass (not a VS Code tasks file, or no folderOpen auto-run);
// 2 — block. Fails open on read/parse errors (exit 0).

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow vscode-folder-open-task bypass'

// `.vscode/tasks.json` — the canonical VS Code tasks file (path normalized to
// `/` before matching, so a Windows `\` path still matches).
const VSCODE_TASKS_RE = /(?:^|\/)\.vscode\/tasks\.json$/
// `*.code-workspace` — a workspace file can embed the same `tasks` + runOptions.
const CODE_WORKSPACE_RE = /\.code-workspace$/

export function isVscodeTaskPath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return VSCODE_TASKS_RE.test(normalized) || CODE_WORKSPACE_RE.test(normalized)
}

// The smoking gun: a task whose `runOptions.runOn` is `folderOpen`. JSONC allows
// comments + arbitrary whitespace, so match the key/value pair tolerantly
// rather than JSON-parsing (which a comment would break) — `"runOn"` : `"folderOpen"`.
const FOLDER_OPEN_RE = /"runOn"\s*:\s*"folderOpen"/

export const check = editGuard((filePath, content, payload) => {
  if (!isVscodeTaskPath(filePath)) {
    return undefined
  }
  const text = content ?? ''
  if (!FOLDER_OPEN_RE.test(text)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  const lines: string[] = []
  lines.push(
    '[vscode-folder-open-task-guard] Blocked: a VS Code task set to run on folder open.',
  )
  lines.push(`  File: ${path.basename(filePath)}`)
  lines.push('')
  lines.push(
    '  `"runOptions": { "runOn": "folderOpen" }` runs the task the moment',
  )
  lines.push(
    '  the folder opens in VS Code — zero clicks, before any review. It is a',
  )
  lines.push(
    '  known drive-by / supply-chain RCE vector (malicious dependency, PR, or',
  )
  lines.push('  poisoned cascade) and a common infostealer dropper.')
  lines.push('')
  lines.push('  Fix: remove the folderOpen auto-run. Run the task manually')
  lines.push(
    '  (Tasks: Run Task) or on an explicit event — never on folder open.',
  )
  lines.push('')
  lines.push(
    `  Bypass (rare; e.g. this guard's own fixtures): type "${BYPASS_PHRASE}".`,
  )
  return block(lines.join('\n') + '\n')
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
