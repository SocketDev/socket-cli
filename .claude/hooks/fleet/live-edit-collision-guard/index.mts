/*
 * @file Claude Code PreToolUse hook — live-edit-collision-guard.
 *
 * Blocks an Edit / Write / NotebookEdit operation when the target path was
 * written by a DIFFERENT live actor within the last 5 minutes. "Live" means
 * the other actor's ledger file has an updatedAt within the 15-minute TTL.
 *
 * Problem observed live (#239): while a background workflow edited extension
 * src files, the interactive session blind-edited the same files (survived
 * by luck) and was then blocked for three consecutive turns by
 * dirty-worktree-stop-guard because the dirty paths belonged to the live run.
 * The collision is better caught HERE, before the write lands.
 *
 * Actor key: sha256(transcript_path).slice(0,16). The transcript_path
 * discriminates actors — each subagent / workflow-agent gets its own JSONL
 * while the main session has a different one. Keying by its hash gives a
 * stable, content-free filesystem key. See _shared/active-edits-ledger.mts.
 *
 * Block message shape: What / Where / Saw-vs-wanted / Fix — three sanctioned
 * moves:
 *   (a) stop the other run first (TaskStop, then resume via its journal),
 *   (b) queue the edit for after the run lands,
 *   (c) user types `Allow live-edit-collision bypass` verbatim.
 *
 * Fail-open: any IO / parse error falls through (no block), per the fleet's
 * hook contract — "a buggy hook silently allows" beats "a buggy hook wedges
 * the session."
 */

import path from 'node:path'
import process from 'node:process'

import {
  COLLISION_WINDOW_MS,
  computeActorId,
  isActorLive,
  LEDGER_TTL_MS,
  ledgerFilePath,
  listOtherActorLedgerPaths,
  lookupPath,
  normalizeForLedger,
  pruneLedger,
  readActorLedger,
  resolveStoreRoot,
} from '../_shared/active-edits-ledger.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import { readFilePath } from '../_shared/payload.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow live-edit-collision bypass'

function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
}

/**
 * Pure decision core — injectable clock, no disk IO. Returns the collision
 * result when the target path was written by a live foreign actor within the
 * collision window; `undefined` (allow) otherwise.
 *
 * Factored out so tests can call it directly without real filesystem or
 * transcript IO.
 */
export interface CollisionResult {
  readonly otherActorId: string
  readonly secondsAgo: number
}

export function detectCollision(
  ownActorId: string,
  normalizedPath: string,
  otherLedgerPaths: readonly string[],
  options: {
    now: number
    collisionWindowMs: number
    ttlMs: number
    // Own actor's last-write timestamp for this path, if any. When defined and
    // strictly newer than a foreign write, the foreign write is ignored — we
    // already re-claimed the file after the foreign actor wrote it.
    ownWriteTs?: number | undefined
  },
): CollisionResult | undefined {
  const { now, collisionWindowMs, ttlMs, ownWriteTs } = {
    __proto__: null,
    ...options,
  } as typeof options
  for (let i = 0, { length } = otherLedgerPaths; i < length; i += 1) {
    const fp = otherLedgerPaths[i]!
    const raw = readActorLedger(fp)
    if (!raw) {
      continue
    }
    if (raw.actorId === ownActorId) {
      continue
    }
    if (!isActorLive(raw, { now, ttlMs })) {
      continue
    }
    const ledger = pruneLedger(raw, { now, ttlMs })
    if (!ledger) {
      continue
    }
    const lastWrite = lookupPath(ledger, normalizedPath)
    if (lastWrite === undefined) {
      continue
    }
    if (now - lastWrite > collisionWindowMs) {
      continue
    }
    // Own actor wrote this file MORE RECENTLY than the foreign actor → we
    // re-claimed it; the foreign write is superseded. Allow the re-edit.
    if (ownWriteTs !== undefined && ownWriteTs >= lastWrite) {
      continue
    }
    return {
      otherActorId: raw.actorId,
      secondsAgo: Math.round((now - lastWrite) / 1000),
    }
  }
  return undefined
}

export function check(payload: ToolCallPayload): GuardResult {
  const tool = payload?.tool_name
  if (tool !== 'Edit' && tool !== 'NotebookEdit' && tool !== 'Write') {
    return undefined
  }

  // Bypass check FIRST — transcript IO before ledger IO, exactly like the
  // other guards (ai-config-poisoning-guard etc.).
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }

  const filePath = readFilePath(payload)
  if (!filePath) {
    return undefined
  }

  const ownActorId = computeActorId(payload.transcript_path)
  if (!ownActorId) {
    return undefined
  }

  const projectDir = getProjectDir()
  const storeRoot = resolveStoreRoot(projectDir)
  const absPath = path.resolve(projectDir, filePath)
  const normalizedPath = normalizeForLedger(absPath)

  // Fail-open: if own ledger lookup is unavailable, skip any self-check.
  const ownFp = ledgerFilePath(storeRoot, ownActorId)
  const ownLedger = readActorLedger(ownFp)
  const now = Date.now()
  // Our own write timestamp for this path — used to determine recency vs foreign.
  const ownWrite = ownLedger ? lookupPath(ownLedger, normalizedPath) : undefined

  const otherPaths = listOtherActorLedgerPaths(storeRoot, ownActorId)
  if (!otherPaths.length) {
    return undefined
  }

  const collision = detectCollision(ownActorId, normalizedPath, otherPaths, {
    now,
    collisionWindowMs: COLLISION_WINDOW_MS,
    ttlMs: LEDGER_TTL_MS,
    ownWriteTs: ownWrite,
  })
  if (!collision) {
    return undefined
  }

  const shortPath = path.relative(projectDir, absPath)
  return block(
    [
      `🚨 live-edit-collision-guard: another live session last wrote this path`,
      `${collision.secondsAgo}s ago — editing now risks a blind overwrite.`,
      ``,
      `File:         ${shortPath}`,
      `Other actor:  ${collision.otherActorId}`,
      `Last write:   ${collision.secondsAgo}s ago (within ${COLLISION_WINDOW_MS / 1000 / 60}-min collision window)`,
      ``,
      `Sanctioned moves:`,
      `  (a) Stop the other run first — use TaskStop, then resume via its`,
      `      journal (.claude/plans/...) once it has landed.`,
      `  (b) Queue this edit for after the other run completes; work on a`,
      `      different file in the meantime.`,
      `  (c) The other run is already finished or abandoned — the user types`,
      `      "${BYPASS_PHRASE}" verbatim to proceed.`,
      ``,
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'NotebookEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
