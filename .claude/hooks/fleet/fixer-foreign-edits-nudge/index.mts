#!/usr/bin/env node
// Claude Code PreToolUse hook — fixer-foreign-edits-nudge.
//
// A fixer / formatter / install run by session A rewrites whatever is
// dirty — including files a live session B wrote seconds ago, whose next
// Edit then fails on an anchor mismatch, or silently blends. The
// collision guard cannot see this (it gates Edit/Write, not Bash), so
// this nudge warns BEFORE a write-capable command runs when the repo's
// dirty set intersects paths live FOREIGN actors recorded recently.
// Advisory only — never blocks; the fixer may be exactly what both
// sessions want.

import path from 'node:path'

// oxlint-disable-next-line socket/prefer-async-spawn -- PreToolUse hook: one short git status; the dispatcher runs hooks synchronously
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  COLLISION_WINDOW_MS,
  computeActorId,
  isActorLive,
  LEDGER_TTL_MS,
  listOtherActorLedgerPaths,
  lookupPath,
  normalizeForLedger,
  readActorLedger,
  resolveStoreRoot,
} from '../_shared/active-edits-ledger.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { isWriteCapableCommand } from '../active-edits-bash-recorder/index.mts'

const MAX_LISTED = 8

export const check = (payload: ToolCallPayload): GuardResult => {
  if (payload.tool_name !== 'Bash') {
    return undefined
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string' || !isWriteCapableCommand(command)) {
    return undefined
  }
  const ownActorId = computeActorId(payload.transcript_path)
  const projectDir = resolveProjectDir()
  // stdioString:false — the trimming default eats the leading space of an
  // unstaged ` M <path>` entry and shifts the first parsed path left by
  // one char, the land-work porcelain pitfall.
  const status = spawnSync('git', ['status', '--porcelain', '-z'], {
    cwd: projectDir,
    stdioString: false,
    timeout: 10_000,
  })
  if (status.status !== 0) {
    return undefined
  }
  const dirty = String(status.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    .map(entry => entry.slice(3))
    .filter(Boolean)
  if (dirty.length === 0) {
    return undefined
  }
  const storeRoot = resolveStoreRoot(projectDir)
  const now = Date.now()
  const foreignLedgerPaths = listOtherActorLedgerPaths(
    storeRoot,
    ownActorId ?? '',
  )
  const foreignOwned: string[] = []
  for (let i = 0, { length } = dirty; i < length; i += 1) {
    const rel = dirty[i]!
    const normalized = normalizeForLedger(path.resolve(projectDir, rel))
    for (let j = 0, n = foreignLedgerPaths.length; j < n; j += 1) {
      const ledger = readActorLedger(foreignLedgerPaths[j]!)
      if (!ledger || !isActorLive(ledger, { now, ttlMs: LEDGER_TTL_MS })) {
        continue
      }
      const ts = lookupPath(ledger, normalized)
      if (ts !== undefined && now - ts <= COLLISION_WINDOW_MS) {
        foreignOwned.push(rel)
        break
      }
    }
  }
  if (foreignOwned.length === 0) {
    return undefined
  }
  const listed = foreignOwned.slice(0, MAX_LISTED)
  return notify(
    `fixer-foreign-edits-nudge: this command can rewrite ${foreignOwned.length} ` +
      `path(s) a LIVE parallel session wrote in the last 5 minutes:\n` +
      `${listed.map(p => `  - ${p}`).join('\n')}\n` +
      `  Prefer a scoped run (--staged, or name your own files) so the ` +
      `peer's in-flight work is not reformatted under it.`,
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
