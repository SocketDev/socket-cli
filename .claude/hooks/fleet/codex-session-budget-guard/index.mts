#!/usr/bin/env node
// Claude Code PreToolUse hook — codex-session-budget-guard.
//
// Codex companion sessions are for QUICK CHECKS, not long sessions. A runaway
// multi-hour companion once looped land-work.mts / cover.mts and monopolized
// the shared checkout for a whole session (CLAUDE.md "Codex companion
// sessions are for quick checks").
//
// IDENTITY — presence of CODEX_COMPANION_SESSION_ID is NOT enough. The codex
// plugin's SessionStart hook exports that var into EVERY session's env with
// the session's OWN id (job tracking), so the primary session sees it too —
// treating presence as "companion" once blanket-blocked every work tool in a
// primary session after 60s (even `ls`), which is exactly the failure a
// guard must never have. The real discriminator: a session's transcript_path
// embeds its OWN session id (…/<id>.jsonl, and its subagents live under a
// …/<id>/subagents/… dir), so an env id that appears IN the transcript path
// is just this session's exported self-id → no-op. Only a FOREIGN id — a
// different session carrying its parent's id — marks a true companion.
// Underivable transcript paths fail OPEN.
//
// On the companion's FIRST tool call the guard stamps a start marker under
// node_modules/.cache; every later call re-reads it, and once the budget is
// spent every further call blocks with a hand-off message.
//
// Fail-open on any IO error: a guard bug must never wedge a legitimate
// session.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// A Codex companion "quick check" gets ONE minute of wall clock; past it the
// companion must wrap up and hand off sustained work to a full Claude session.
export const BUDGET_MS = 60_000

const STORE = 'socket-codex-session'

export interface BudgetVerdict {
  readonly exceeded: boolean
  readonly minutes: number
}

// Pure decision: has `nowMs - startMs` passed `budgetMs`, and how many whole
// minutes have elapsed (for the message). Negative elapsed clamps to 0.
export function budgetVerdict(
  budgetMs: number,
  nowMs: number,
  startMs: number,
): BudgetVerdict {
  const elapsed = Math.max(0, nowMs - startMs)
  return { exceeded: elapsed > budgetMs, minutes: Math.floor(elapsed / 60_000) }
}

// The companion session id, or undefined when this is not a Codex companion.
export function codexCompanionId(env: NodeJS.ProcessEnv): string | undefined {
  const id = env['CODEX_COMPANION_SESSION_ID']
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * True when the env-carried id belongs to THIS session: the id appears in the
 * session's own transcript path (`…/<id>.jsonl` for the main transcript,
 * `…/<id>/subagents/…` for its subagents). The codex plugin exports the var
 * with the session's own id into every session, so a self-id means "not a
 * companion". An absent/underivable transcript path also returns true —
 * fail open, never gate a session we can't identify.
 */
export function isOwnSessionId(
  companionId: string,
  transcriptPath: string | undefined,
): boolean {
  if (typeof transcriptPath !== 'string' || !transcriptPath) {
    return true
  }
  return transcriptPath.includes(companionId)
}

// The marker file holding a companion's first-tool-call timestamp, keyed by the
// companion id (sanitized to a safe filename). Runtime state — never tracked.
export function markerFile(projectDir: string, companionId: string): string {
  const safe = companionId.replace(/[^A-Za-z0-9_-]/g, '')
  return path.join(projectDir, 'node_modules', '.cache', STORE, `${safe}.json`)
}

// Read the stamped start timestamp; undefined when missing or unparseable.
export function readStartMs(file: string): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      start?: unknown
    }
    return typeof parsed.start === 'number' ? parsed.start : undefined
  } catch {
    return undefined
  }
}

// Stamp the start timestamp. Fail-open: if it can't be written, the guard simply
// can't enforce this session (never throws into the tool call).
export function stampStartMs(file: string, startMs: number): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ start: startMs }))
  } catch {}
}

export function check(payload: ToolCallPayload): GuardResult {
  const companionId = codexCompanionId(process.env)
  if (!companionId) {
    return undefined
  }
  // Self-id (or unidentifiable session) → primary session, not a companion.
  if (isOwnSessionId(companionId, payload.transcript_path)) {
    return undefined
  }
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
  const file = markerFile(projectDir, companionId)
  const now = Date.now()
  const start = readStartMs(file)
  if (start === undefined) {
    // First tool call of this companion — start the clock, allow.
    stampStartMs(file, now)
    return undefined
  }
  const { exceeded, minutes } = budgetVerdict(BUDGET_MS, now, start)
  if (!exceeded) {
    return undefined
  }
  const budgetLabel = `${Math.round(BUDGET_MS / 1000)}s`
  return block(
    [
      '[codex-session-budget-guard] Codex companion session exceeded its quick-check budget.',
      '',
      `  What:  this Codex companion (${companionId.slice(0, 8)}…) has run ${minutes} min; the budget is ${budgetLabel}.`,
      '  Why:   Codex companions are for QUICK CHECKS, not long sessions — a long',
      '         companion loops build/land work and monopolizes the shared checkout.',
      '  Fix:   wrap up; hand sustained work to a full Claude session.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['codex-long-session'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  // The work-tools the settings.json PreToolUse dispatcher matcher covers. A
  // companion doing read-only reconnaissance past the budget is tolerated; it
  // blocks at its first WORK tool call. Match-all would force the dispatcher
  // matcher to `.*`, taxing every tool call in every session.
  matcher: [
    'AskUserQuestion',
    'Bash',
    'Edit',
    'MultiEdit',
    'NotebookEdit',
    'Task',
    'Workflow',
    'Write',
  ],
  type: 'guard',
})

void runHook(hook, import.meta.url)
