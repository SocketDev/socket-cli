#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-fff-search-nudge.
//
// Nudges the agent toward the fff MCP search tools (`ffgrep` content search,
// `fffind` path search, `fff-multi-grep`) whenever it reaches for ripgrep/grep:
// the built-in `Grep` tool, or a bash `rg` / `ripgrep` / recursive `grep -r`
// invocation. fff (`.mcp.json` → `fff-mcp`, a resident Rust index installed by
// setup-tools) keeps the index + file cache warm across the session — sub-10ms
// queries vs 3-9s per ripgrep spawn on a large tree — and ranks definitions
// first with frecency + git-aware annotations, so the agent lands on the right
// code in fewer roundtrips and less context. See docs/agents.md/fleet/tooling.md.
//
// Non-blocking (type: 'nudge'): ripgrep/grep stay valid for scripts + one-off
// shell use, and fff's MCP tools aren't loaded in every client/session, so a
// hard block would strand a search. Time-throttled (default 2h, override with
// SOCKET_FFF_NUDGE_INTERVAL_HOURS) so a search-heavy session gets one reminder,
// not a flood. Fails open on any error — a nudge must never brick a search.

import {
  existsSync,
  mkdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { findInvocation } from '../_shared/shell-command.mts'

const STATE_DIR = path.join(
  os.homedir(),
  '.claude',
  'hooks',
  'prefer-fff-search',
)
const STATE_FILE = path.join(STATE_DIR, 'last-nudge')

// Throttle window in ms. 2h default; 0 = nudge every time (verbose); a
// negative / unparseable value falls back to the default.
export function intervalMs(): number {
  const raw = process.env['SOCKET_FFF_NUDGE_INTERVAL_HOURS']
  const hours = raw === undefined ? 2 : Number.parseFloat(raw)
  if (!Number.isFinite(hours) || hours < 0) {
    return 2 * 60 * 60 * 1000
  }
  return Math.round(hours * 60 * 60 * 1000)
}

export function withinThrottle(nowMs: number = Date.now()): boolean {
  const interval = intervalMs()
  if (interval === 0) {
    return false
  }
  if (!existsSync(STATE_FILE)) {
    return false
  }
  try {
    return nowMs - statSync(STATE_FILE).mtimeMs < interval
  } catch {
    /* c8 ignore next - statSync only throws on a TOCTOU race after existsSync; not testable without FS mocks */
    return false
  }
}

export function touchState(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    if (!existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, '')
    }
    const now = new Date()
    utimesSync(STATE_FILE, now, now)
  } catch {
    // Throttle is best-effort: a write failure just means the next search
    // re-nudges. Never surface it.
  }
}

// True when a bash command reaches for ripgrep/grep as a REPO SEARCH: the
// dedicated search binaries `rg` / `ripgrep` (any invocation), or a recursive
// `grep` (`-r` / `-R` / `--recursive`). A bare `… | grep foo` pipe-filter of
// another command's output is NOT a repo search and is intentionally left
// alone. Parser-backed (findInvocation), so a quoted "rg" or a path containing
// "grep" does not trip it.
export function isSearchCommand(command: string): boolean {
  if (
    findInvocation(command, { binary: 'rg' }) ||
    findInvocation(command, { binary: 'ripgrep' })
  ) {
    return true
  }
  if (findInvocation(command, { binary: 'grep' })) {
    // Recursive grep = file-tree search. Short-flag cluster (`-rn`, `-Rl`) or
    // the long form. Scope to the first segment so a pipe into a later command
    // doesn't widen the match.
    const firstSegment = command.split(/[|;&]/)[0] ?? command
    // r/R anywhere in a short-flag cluster (`-r`, `-Rn`, `-nr`) or the long
    // `--recursive`. socket-lint: allow uncommented-regex
    return /\bgrep\b[^|;&]*(?:\s-[A-Za-z]*[rR][A-Za-z]*\b|\s--recursive\b)/.test(
      firstSegment,
    )
  }
  return false
}

// True when this tool call is a repo search fff should serve: the built-in
// `Grep` tool, or a bash rg/ripgrep/recursive-grep invocation.
export function isSearchIntent(payload: ToolCallPayload): boolean {
  const tool = payload?.tool_name
  if (tool === 'Grep') {
    return true
  }
  if (tool === 'Bash') {
    const raw = payload?.tool_input?.command
    const cmd = typeof raw === 'string' ? raw : ''
    return cmd.length > 0 && isSearchCommand(cmd)
  }
  return false
}

export const MESSAGE = [
  '[prefer-fff-search] Prefer the fff MCP search tools over ripgrep/grep.',
  '  Reach for `ffgrep` (content), `fffind` (paths), or `fff-multi-grep` — a',
  '  resident, frecency-ranked, git-aware index (sub-10ms vs 3-9s per ripgrep',
  '  spawn on a large tree), so you land on the right code in fewer roundtrips',
  '  and less context. ripgrep/grep stay fine for scripts + one-off shell use.',
  '  Details: docs/agents.md/fleet/tooling.md.',
].join('\n')

export const check = (payload: ToolCallPayload): GuardResult => {
  if (!isSearchIntent(payload)) {
    return undefined
  }
  if (withinThrottle()) {
    return undefined
  }
  touchState()
  return notify(MESSAGE)
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Grep'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
