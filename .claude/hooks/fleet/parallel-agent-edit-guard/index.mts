#!/usr/bin/env node
// Claude Code PreToolUse hook — parallel-agent-edit-guard.
//
// Blocks an Edit / Write / NotebookEdit whose target file is ANOTHER
// agent's in-flight work: a path that is dirty in this checkout, was NOT
// authored by this session, and changed recently. Writing it would
// silently clobber the other agent's uncommitted edits (the failure mode
// where two sessions share one `.git/` and each overwrites the other's
// changes mid-edit).
//
// Relationship to the sibling parallel-agent hooks:
//   • parallel-agent-staging-guard — refuses git ops (add -A / stash /
//     reset --hard / …) that sweep up or destroy foreign work.
//   • parallel-agent-on-stop-nudge — surfaces the foreign-path signal
//     at turn end (informational).
//   • THIS hook — refuses the direct file write that clobbers a foreign
//     file before it lands. Same "foreign" heuristic
//     (`_shared/foreign-paths.mts`), applied to the edit target.
//
// Only fires when the target is itself foreign — editing your own files,
// or any file when no parallel agent is active, passes through. A fresh
// (untouched-by-anyone) file is never foreign.
//
// Why this exists (incident 2026-05-27): two Claude sessions + a Codex
// companion shared one socket-wheelhouse checkout. One session kept
// re-cascading shell-command.mts / test files, silently reverting the
// other's type-error fixes Edit-by-Edit. The staging guard didn't catch
// it (no git op involved) — the clobber was a plain Write.
//
// Bypass:
//   • `Allow parallel-agent-edit bypass` in a recent user turn
//     (case-sensitive) — one action.
//   • `FLEET_SYNC=1` in env — cascade scripts run in a fresh worktree off
//     origin/main and have no parallel-session hazard.
//
// Fails open on hook bugs (exit 0 + stderr log). Reads a PreToolUse JSON
// payload from stdin:
//   { "tool_name": "Edit" | "Write" | "NotebookEdit",
//     "tool_input": { "file_path": "..." },
//     "transcript_path": "/.../session.jsonl" }

import path from 'node:path'
import process from 'node:process'

import {
  listForeignDirtyPaths,
  readSessionTouchedPaths,
  recordTouchedPath,
} from '../_shared/foreign-paths.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const EDIT_TOOLS = new Set(['Edit', 'NotebookEdit', 'Write'])

function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (process.env['FLEET_SYNC'] === '1') {
    return undefined
  }
  if (!payload.tool_name || !EDIT_TOOLS.has(payload.tool_name)) {
    return undefined
  }
  const filePath = (
    payload.tool_input as { file_path?: unknown | undefined } | undefined
  )?.file_path
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return undefined
  }

  const repoDir = getProjectDir()
  const targetAbs = path.resolve(repoDir, filePath)

  const touched = readSessionTouchedPaths(payload.transcript_path)
  // If THIS session already authored the target, it's ours — not foreign.
  if (touched.has(targetAbs)) {
    // Re-record so a third+ edit this turn keeps recognizing it (the
    // transcript still lags; the ledger is what carries the memory).
    recordTouchedPath(payload.transcript_path, targetAbs)
    return undefined
  }

  const foreign = listForeignDirtyPaths(repoDir, touched)
  if (foreign.length === 0) {
    // Not a parallel-agent hazard — allow, and remember we touched it so a
    // follow-up edit this turn doesn't read the now-dirty file as foreign.
    recordTouchedPath(payload.transcript_path, targetAbs)
    return undefined
  }
  // The target is foreign only if it's in the foreign-dirty set.
  const targetIsForeign = foreign.some(
    rel => path.resolve(repoDir, rel) === targetAbs,
  )
  if (!targetIsForeign) {
    recordTouchedPath(payload.transcript_path, targetAbs)
    return undefined
  }

  return block(
    [
      `[parallel-agent-edit-guard] Blocked: ${payload.tool_name} ${filePath}`,
      '',
      "  This file is dirty and NOT from this session's edits. Most likely",
      "  it's your OWN earlier work (recall resets across compaction) or an",
      '  aligned session heading the same way — overwriting it now would',
      '  lose those uncommitted changes.',
      '',
      '  Do this instead:',
      '  • Confirm it is yours — `node scripts/fleet/whose-work.mts` + git diff.',
      '  • LAND the current state first — `git commit -o <file>` or',
      '    `node scripts/fleet/land-work.mts --commit` — then edit it clean.',
      '  • A genuine concurrent editor on this `.git/` is the rare case; if',
      '    so, let it land or take the edit into a `git worktree`.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['parallel-agent-edit'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
