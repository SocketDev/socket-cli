#!/usr/bin/env node
// Claude Code PostToolUse hook — active-edits-bash-recorder.
//
// The active-edits ledger's recorder covers Edit/Write/NotebookEdit only,
// so file mutations made THROUGH Bash — a fixer (`pnpm run fix`), a
// formatter, an install rewriting the lockfile, a codegen script — were
// invisible to every ledger consumer: the collision guard could not warn
// a live peer, the stop guard could not attribute the dirt, and
// whose-work drew a blank. This companion fires after a write-capable
// Bash command and records the RECENTLY-MUTATED dirty paths into this
// actor's ledger with `via: 'bash'` provenance — a weaker signal than an
// Edit (a fixer touching a peer's file is not authorship), which
// consumers can distinguish via the ledger's `via` map.
//
// Heuristic, fail-open, never blocks: no Pre/Post snapshot pair exists,
// so "recently mutated" = dirty in `git status` AND mtime within the
// recent window. Covers the fixer / formatter / install / codegen
// command shapes; a bespoke redirect or heredoc write stays invisible
// (the parser drops redirect operands by design).

import { statSync } from 'node:fs'
import path from 'node:path'

// oxlint-disable-next-line socket/prefer-async-spawn -- PostToolUse hook: one short git status; the dispatcher runs hooks synchronously
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  computeActorId,
  LEDGER_TTL_MS,
  ledgerFilePath,
  normalizeForLedger,
  readActorLedger,
  recordPath,
  resolveStoreRoot,
  writeActorLedger,
} from '../_shared/active-edits-ledger.mts'
import { defineHook, runHook } from '../_shared/guard.mts'
import { isGenerated } from '../_shared/landable.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const PM_BINARIES = new Set(['npm', 'pnpm', 'yarn'])
const PM_WRITE_SCRIPTS = new Set(['fix', 'fmt', 'format', 'lint'])
const PM_INSTALL_ARGS = new Set(['add', 'i', 'install', 'up', 'update'])
// A node-run script whose basename says it mutates the tree.
const NODE_WRITE_SCRIPT_RE =
  /(?:build|codegen|fix|format|gen|generate|land|sync)[^/]*\.m?[jt]s$/

// Only paths mutated this recently are attributed to the command. Wide
// enough for a slow fixer pass, tight enough to skip long-dirty peers'
// files the command never touched.
export const RECENT_WRITE_MS = 120 * 1000

// Cap per invocation so a giant install diff can't bloat the ledger.
const MAX_RECORDED_PATHS = 200

export function isWriteCapableCommand(command: string): boolean {
  const commands = parseCommands(command)
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const c = commands[i]!
    if (PM_BINARIES.has(c.binary)) {
      const positional = c.args.filter(a => a && !a.startsWith('-'))
      const script = positional[0] === 'run' ? positional[1] : positional[0]
      if (
        script &&
        (PM_WRITE_SCRIPTS.has(script) || PM_INSTALL_ARGS.has(script))
      ) {
        return true
      }
    }
    if (c.binary === 'node' && c.args.some(a => NODE_WRITE_SCRIPT_RE.test(a))) {
      return true
    }
  }
  return false
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (payload.tool_name !== 'Bash') {
    return undefined
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string' || !isWriteCapableCommand(command)) {
    return undefined
  }
  const actorId = computeActorId(payload.transcript_path)
  if (!actorId) {
    return undefined
  }
  const projectDir = resolveProjectDir()
  // stdioString:false — the trimming default eats the leading space of an
  // unstaged ` M <path>` entry and shifts the first parsed path left by
  // one char (the land-work porcelain pitfall).
  const status = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '-z'],
    { cwd: projectDir, stdioString: false, timeout: 10_000 },
  )
  if (status.status !== 0) {
    return undefined
  }
  const now = Date.now()
  const dirty = String(status.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    .map(entry => entry.slice(3))
    .filter(Boolean)
  const storeRoot = resolveStoreRoot(projectDir)
  const fp = ledgerFilePath(storeRoot, actorId)
  let ledger = readActorLedger(fp)
  let recorded = 0
  for (let i = 0, { length } = dirty; i < length; i += 1) {
    if (recorded >= MAX_RECORDED_PATHS) {
      break
    }
    if (isGenerated(dirty[i]!)) {
      // Shared generated artifacts (lockfile, bundles) are everyone's —
      // recording them as this actor's writes would false-fire the
      // collision guard on the noisiest files in the repo.
      continue
    }
    const abs = path.resolve(projectDir, dirty[i]!)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(abs).mtimeMs
    } catch {
      continue
    }
    if (now - mtimeMs > RECENT_WRITE_MS) {
      continue
    }
    ledger = recordPath(ledger, actorId, normalizeForLedger(abs), {
      now,
      ttlMs: LEDGER_TTL_MS,
      via: 'bash',
    })
    recorded += 1
  }
  if (recorded > 0 && ledger) {
    writeActorLedger(fp, {
      ...ledger,
      pid: process.pid,
      label: payload.transcript_path
        ? path.basename(payload.transcript_path, '.jsonl')
        : undefined,
    })
  }
  return undefined
}

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
