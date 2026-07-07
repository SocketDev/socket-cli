#!/usr/bin/env node
// Claude Code PostToolUse hook — active-edits-ledger (recorder).
//
// Fires after every Edit / Write / NotebookEdit tool call. Records the
// target file path into THIS actor's per-session ledger so that:
//
//   • live-edit-collision-guard (PreToolUse, slice 2) can detect when
//     a DIFFERENT live actor last wrote a given path recently.
//   • dirty-worktree-stop-guard (slice 3) can exempt paths owned by a
//     live foreign actor from its blocking set.
//   • excuse-detector (slice 4) can gate promissory-wait patterns on
//     whether a live foreign actor is actually present.
//
// This hook is the ONLY write path to the ledger — it never blocks and
// exits 0 on every code path including errors. A broken recorder is
// invisible (fail-open), not a session stopper.
//
// Actor key: hash of `transcript_path` (first 16 hex chars). The
// transcript_path discriminates actors because each subagent / workflow-
// agent gets its own JSONL file while the main interactive session has a
// different one. Keying by its hash gives a stable, content-free
// filesystem key per actor — the same scheme foreign-paths.mts uses for
// its same-turn ledger.
//
// Store: `CLAUDE_PROJECT_DIR/node_modules/.cache/socket-active-edits/`
// (dep-0 runtime state; never tracked).

import path from 'node:path'
import process from 'node:process'

import {
  LEDGER_TTL_MS,
  computeActorId,
  ledgerFilePath,
  normalizeForLedger,
  readActorLedger,
  recordPath,
  resolveStoreRoot,
  sweepStaleLedgers,
  writeActorLedger,
} from '../_shared/active-edits-ledger.mts'
import { defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readFilePath } from '../_shared/payload.mts'

const EDIT_TOOLS = new Set(['Edit', 'NotebookEdit', 'Write'])

function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (!payload.tool_name || !EDIT_TOOLS.has(payload.tool_name)) {
    return undefined
  }
  const filePath = readFilePath(payload)
  if (!filePath) {
    return undefined
  }
  const transcriptPath = payload.transcript_path
  const actorId = computeActorId(transcriptPath)
  if (!actorId) {
    return undefined
  }
  const projectDir = getProjectDir()
  const storeRoot = resolveStoreRoot(projectDir)
  const fp = ledgerFilePath(storeRoot, actorId)
  const now = Date.now()
  const absPath = path.resolve(projectDir, filePath)
  const normalizedPath = normalizeForLedger(absPath)
  const existing = readActorLedger(fp)
  const updated = recordPath(existing, actorId, normalizedPath, {
    now,
    ttlMs: LEDGER_TTL_MS,
  })
  writeActorLedger(fp, updated)
  sweepStaleLedgers(storeRoot, { now, ttlMs: LEDGER_TTL_MS })
  return undefined
}

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'NotebookEdit', 'Write'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
