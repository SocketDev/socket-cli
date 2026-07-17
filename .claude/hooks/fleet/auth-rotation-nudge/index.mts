#!/usr/bin/env node
// Claude Code Stop hook — auth-rotation-nudge.
//
// Periodically logs you out of authenticated CLIs (npm, pnpm, gcloud,
// vault, aws sso, docker, socket, …) so stale long-lived tokens don't
// sit in dotfiles or keychains for days.
//
// Rotation is IDLE-based, not elapsed-based. A state file records the
// LAST Stop event; every Stop is treated as activity and resets that
// clock. Rotation fires only once the session has sat IDLE — no Stop —
// for >= the configured idle timeout. A continuously active session
// (Stops minutes apart) keeps resetting the clock and never rotates
// mid-work; only genuine inactivity counts toward the timeout.
//
// Behavior on each Stop event:
//
//   1. Drain stdin (Stop hook delivers a JSON payload we don't need).
//   2. Skip if running in CI (CI auth has its own lifecycle).
//   3. Read both global + project-local `.snooze` files. Each carries
//      an ISO 8601 expiry on line 1; if past, the file is auto-cleaned
//      and the hook proceeds. If unexpired, the hook honors the snooze
//      and exits silently.
//   4. Read the idle gap (now − last-activity mtime) from the state
//      file, then record THIS Stop as activity (touch the file to now).
//   5. Rotate only when a leak warning was just detected OR the idle gap
//      is >= the idle timeout (default 1h). The first Stop of a fresh
//      session (no state file yet) is treated as activity and never
//      rotates.
//   6. For each service in services.mts:
//        a. Skip if the binary is missing and `optional: true`.
//        b. Run detectCmd. Skip if not authenticated.
//        c. Run logoutCmd. Surface the result as a notify() line.
//
// The hook NEVER reads, prints, or compares any token value. Detection
// is exit-code only; logout commands' output is suppressed except for
// non-zero exit codes which surface as "logout failed" lines.
//
// Snooze file format (ISO 8601 timestamp on line 1):
//
//   $ date -ud '+4 hours' +"%Y-%m-%dT%H:%M:%SZ" > .claude/auth-rotation.snooze
//
// Removed automatically once the timestamp is reached.
//
// Configuration env vars (all optional):
//
//   SOCKET_AUTH_ROTATION_INTERVAL_HOURS   default: 1
//     Idle timeout in hours: how long the session must sit idle (no
//     Stop events) before the next Stop triggers rotation. Set to 0 to
//     rotate on every Stop event after the first (verbose).

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import {
  readLastAssistantText,
  stripCodeFences,
} from '../_shared/transcript.mts'

import { DEFAULT_SKIP_IDS, SERVICES } from './services.mts'
import type { Service } from './services.mts'

const PREFIX = '[auth-rotation-nudge]'

// ── Paths ───────────────────────────────────────────────────────────

const STATE_DIR = path.join(os.homedir(), '.claude', 'hooks', 'auth-rotation')
// Tracks the LAST Stop event (last activity), not the last rotation — its
// mtime is the baseline the idle-gap check measures against.
const STATE_FILE = path.join(STATE_DIR, 'last-activity')
const GLOBAL_SNOOZE = path.join(STATE_DIR, 'snooze')
const GLOBAL_SKIP_LIST = path.join(STATE_DIR, 'services-skip')

// Project-local files live at the repo root next to .claude/. Use
// CLAUDE_PROJECT_DIR (Claude Code injects this on every hook run) so
// the paths stay correct regardless of session cwd — process.cwd()
// drifts when the user navigates into a subpackage.
const PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const PROJECT_SNOOZE = path.join(PROJECT_DIR, '.claude', 'auth-rotation.snooze')
const PROJECT_SKIP_LIST = path.join(
  PROJECT_DIR,
  '.claude',
  'auth-rotation.services-skip',
)

// ── Snooze handling ─────────────────────────────────────────────────

interface SnoozeStatus {
  active: boolean
  cleaned: string[]
  errors: string[]
}

export async function checkSnoozes(): Promise<SnoozeStatus> {
  const status: SnoozeStatus = { active: false, cleaned: [], errors: [] }
  const cleanFile = async (file: string, reason: string): Promise<void> => {
    try {
      await safeDelete(file)
      status.cleaned.push(file)
    } catch (e) {
      /* c8 ignore start - safeDelete only throws on permission errors (e.g. immutable FS), not testable without root/chattr */
      status.errors.push(
        `${PREFIX} safeDelete(${path.basename(file)}) failed (${reason}): ${errorMessage(e)}`,
      )
      /* c8 ignore stop */
    }
  }
  for (const file of [GLOBAL_SNOOZE, PROJECT_SNOOZE]) {
    if (!existsSync(file)) {
      continue
    }
    let content = ''
    try {
      content = readFileSync(file, 'utf8').trim()
    } catch {
      await cleanFile(file, 'unreadable')
      continue
    }
    // Empty content = legacy form, no expiry. Treat as expired now.
    if (content.length === 0) {
      await cleanFile(file, 'legacy (no expiry)')
      continue
    }
    const firstLine = content.split('\n')[0]!.trim()
    const expiry = Date.parse(firstLine)
    if (Number.isNaN(expiry)) {
      await cleanFile(file, 'malformed expiry')
      continue
    }
    if (Date.now() >= expiry) {
      await cleanFile(file, 'expired')
      continue
    }
    // Unexpired snooze. Honor it.
    status.active = true
    return status
  }
  return status
}

// ── Skip-list ───────────────────────────────────────────────────────

export function loadSkipIds(): Set<string> {
  const skipIds = new Set<string>(DEFAULT_SKIP_IDS)
  for (const file of [GLOBAL_SKIP_LIST, PROJECT_SKIP_LIST]) {
    if (!existsSync(file)) {
      continue
    }
    try {
      const content = readFileSync(file, 'utf8')
      for (const raw of content.split('\n')) {
        const trimmed = raw.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          skipIds.add(trimmed)
        }
      }
    } catch {
      // Ignore unreadable skip-list — better to over-rotate than fail closed.
    }
  }
  return skipIds
}

// ── Leak detection ──────────────────────────────────────────────────

// Patterns that signal the assistant just announced a token leak in
// its own output. Rotate immediately when any of these fire — bypassing
// the idle timeout — instead of waiting for the session to go idle.
//
// The patterns target the WARNING text (i.e., what the assistant
// said about a leak), not the token value itself. token-guard handles
// pre-leak blocking; this is "the leak happened, surface it now."
const LEAK_WARNING_PATTERNS: readonly RegExp[] = [
  /\brotate the token\b/i,
  /\brotate (?:the )?(?:api )?key\b/i,
  /\bleaked into (?:the )?transcript\b/i,
  /\btoken (?:value )?(?:was )?(?:briefly )?visible (?:to me )?(?:at one point )?(?:in )?(?:the )?(?:tool output|transcript|context)\b/i,
  // Bright-red rotation banner shape the security-incident block uses.
  /(?:⚠️|⚠|!)+\s*Rotate the token\b/i,
  // "appears in transcript" / "in conversation transcript"
  /\b(?:appeared|exposed|present) in (?:the )?(?:conversation )?transcript\b/i,
  // "security incident notice" — used by my Token-Hygiene memory
  // template when surfacing a leak.
  /\bsecurity incident notice\b/i,
]

interface LeakDetection {
  triggered: boolean
  matchedPattern: string | undefined
}

/**
 * Scan the most-recent assistant turn (from the Stop-hook JSON payload's
 * transcript_path) for a leak-warning marker. Returns `triggered: true` when
 * any pattern hits — caller bypasses the idle timeout and runs rotation
 * immediately.
 *
 * Caller passes in the raw stdin payload because `main()` already captured it
 * (Node's stdin is single-use).
 */
export function detectLeakWarning(stdinPayload: string): LeakDetection {
  if (!stdinPayload) {
    return { triggered: false, matchedPattern: undefined }
  }
  let payload: { transcript_path?: string | undefined }
  try {
    payload = JSON.parse(stdinPayload) as {
      transcript_path?: string | undefined
    }
  } catch {
    return { triggered: false, matchedPattern: undefined }
  }
  let text: string
  try {
    /* c8 ignore next - readLastAssistantText always returns string; ?? '' RHS is unreachable but kept as a defensive guard */
    text = readLastAssistantText(payload.transcript_path) ?? ''
  } catch {
    /* c8 ignore next - readLastAssistantText is fully defensive and won't throw; catch is a belt-and-suspenders guard */
    return { triggered: false, matchedPattern: undefined }
  }
  if (!text) {
    return { triggered: false, matchedPattern: undefined }
  }
  // Strip code fences so a regex matching inside an example block
  // doesn't fire (those are docs / show-don't-tell, not incidents).
  const stripped = stripCodeFences(text)
  for (let i = 0, { length } = LEAK_WARNING_PATTERNS; i < length; i += 1) {
    const pat = LEAK_WARNING_PATTERNS[i]!
    const m = stripped.match(pat)
    if (m) {
      return { triggered: true, matchedPattern: m[0] }
    }
  }
  return { triggered: false, matchedPattern: undefined }
}

// ── Idle detection ──────────────────────────────────────────────────

// The configured idle timeout, in milliseconds. The session must sit
// idle (no Stop events) at least this long before the next Stop rotates.
export function intervalMs(): number {
  const raw = process.env['SOCKET_AUTH_ROTATION_INTERVAL_HOURS']
  const hours = raw === undefined ? 1 : Number.parseFloat(raw)
  if (!Number.isFinite(hours) || hours < 0) {
    return 60 * 60 * 1000
  }
  return Math.round(hours * 60 * 60 * 1000)
}

// Returns true while the session is still ACTIVE — i.e. rotation should be
// SKIPPED — and false only once the token has sat idle for >= the timeout.
//
// The state file's mtime records the last Stop event (each Stop is
// activity). A missing state file is the very first Stop of a fresh
// session: treat it as activity (return true) so the first run never
// rotates; the caller's touchStateFile() then establishes the baseline.
export function withinThrottle(): boolean {
  // First Stop of a fresh session — no baseline yet, so nothing has been
  // idle. Skip rotation and let the caller stamp the baseline.
  if (!existsSync(STATE_FILE)) {
    return true
  }
  const idleTimeout = intervalMs()
  // Idle timeout 0 → every gap counts as "past timeout"; rotate on every
  // Stop after the first (verbose diagnostic mode).
  if (idleTimeout === 0) {
    return false
  }
  try {
    const { mtimeMs } = statSync(STATE_FILE)
    // Still active while the idle gap is below the timeout.
    return Date.now() - mtimeMs < idleTimeout
  } catch {
    /* c8 ignore next - statSync only throws if file disappears between existsSync and statSync (TOCTOU race); not testable without FS mocks */
    return true
  }
}

export function touchStateFile(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    if (!existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, '')
    }
    const now = new Date()
    utimesSync(STATE_FILE, now, now)
  } catch {
    // Activity stamping is best-effort. Loss = the idle gap looks larger
    // than it is, so we may rotate sooner than the timeout; not worth
    // surfacing.
  }
}

// ── Service detection + logout ──────────────────────────────────────

interface RotationResult {
  loggedOut: string[]
  failed: Array<{ service: string; reason: string }>
  skippedMissing: string[]
}

export function isOnPath(binary: string): boolean {
  // `command -v` is portable across sh/bash/zsh and exits 0 if found.
  const r = spawnSync('sh', ['-c', `command -v ${binary} >/dev/null 2>&1`], {
    stdio: 'ignore',
  })
  return r.status === 0
}

export function isAuthenticated(s: Service): boolean {
  const r = spawnSync(s.detectCmd[0]!, s.detectCmd.slice(1) as string[], {
    stdio: 'ignore',
    timeout: spawnTimeoutMs(5000),
  })
  return r.status === 0
}

export function runLogout(s: Service): {
  ok: boolean
  reason?: string | undefined
} {
  const r = spawnSync(s.logoutCmd[0]!, s.logoutCmd.slice(1) as string[], {
    stdio: 'ignore',
    timeout: spawnTimeoutMs(10_000),
  })
  if (r.status === 0) {
    return { ok: true }
  }
  if (r.error) {
    return { ok: false, reason: r.error.message }
  }
  return { ok: false, reason: `exit code ${r.status}` }
}

export function rotateAll(
  skipIds: Set<string>,
  serviceList: readonly Service[] = SERVICES,
): RotationResult {
  const result: RotationResult = {
    loggedOut: [],
    failed: [],
    skippedMissing: [],
  }
  for (let i = 0, { length } = serviceList; i < length; i += 1) {
    const service = serviceList[i]!
    if (skipIds.has(service.id)) {
      continue
    }
    if (!isOnPath(service.detectCmd[0]!)) {
      if (!service.optional) {
        result.skippedMissing.push(service.name)
      }
      continue
    }
    /* c8 ignore start - isAuthenticated returning true requires a real authenticated CLI session (npm/pnpm/gcloud/etc.) not present in CI or dev test runs */
    if (isAuthenticated(service)) {
      const out = runLogout(service)
      if (out.ok) {
        result.loggedOut.push(service.name)
      } else {
        result.failed.push({
          service: service.name,
          reason: out.reason ?? 'unknown',
        })
      }
    }
    /* c8 ignore stop */
  }
  return result
}

// ── Output ──────────────────────────────────────────────────────────

export function reportSnoozeCleaned(cleaned: string[]): string[] {
  const lines: string[] = []
  for (let i = 0, { length } = cleaned; i < length; i += 1) {
    const file = cleaned[i]!
    lines.push(`${PREFIX} cleared expired snooze: ${file}`)
  }
  return lines
}

export function reportRotation(result: RotationResult): string[] {
  const parts: string[] = []
  if (result.loggedOut.length > 0) {
    parts.push(
      `logged out of ${result.loggedOut.length} CLI(s): ${result.loggedOut.join(', ')}`,
    )
  }
  if (result.failed.length > 0) {
    const failed = result.failed
      .map(f => `${f.service} (${f.reason})`)
      .join(', ')
    parts.push(`logout failed: ${failed}`)
  }
  if (result.skippedMissing.length > 0) {
    parts.push(`expected-but-missing: ${result.skippedMissing.join(', ')}`)
  }
  if (parts.length === 0) {
    return []
  }
  return [
    `${PREFIX} ${parts.join('; ')}`,
    `  Snooze for next 4h:  date -ud "+4 hours" +"%Y-%m-%dT%H:%M:%SZ" > .claude/auth-rotation.snooze`,
  ]
}

// ── Main ────────────────────────────────────────────────────────────

export async function run(stdinPayload: string): Promise<string[]> {
  const lines: string[] = []
  if (process.env['CI']) {
    return lines
  }
  const snooze = await checkSnoozes()
  lines.push(...snooze.errors)
  lines.push(...reportSnoozeCleaned(snooze.cleaned))
  if (snooze.active) {
    return lines
  }
  // Inspect the most-recent assistant turn for a leak-warning marker.
  // When the assistant just said "rotate the token" / "leaked into
  // transcript", rotate immediately — bypassing the idle timeout —
  // instead of waiting for the session to go idle.
  const leak = detectLeakWarning(stdinPayload)
  // Read the idle gap from the last-activity state file BEFORE recording
  // this Stop as new activity.
  const active = withinThrottle()
  // This Stop IS activity: reset the idle clock regardless of the rotation
  // decision below. A continuously active session keeps resetting this, so
  // it never accumulates enough idle time to rotate mid-work.
  touchStateFile()
  if (leak.triggered) {
    lines.push(
      `${PREFIX} leak warning detected in assistant output ("${leak.matchedPattern}"); bypassing idle timeout`,
    )
  } else if (active) {
    // Session still active (idle gap below the timeout) or the first Stop
    // of a fresh session — nothing to rotate yet.
    return lines
  }
  const skipIds = loadSkipIds()
  const result = rotateAll(skipIds)
  lines.push(...reportRotation(result))
  return lines
}

export const check = async (payload: ToolCallPayload): Promise<GuardResult> => {
  // detectLeakWarning() scans the Stop-hook payload (JSON with
  // transcript_path); re-serialize the parsed payload so its existing
  // string parser keeps working unchanged.
  let lines: string[]
  try {
    lines = await run(JSON.stringify(payload))
  } catch (e) {
    lines = [`${PREFIX} unexpected error: ${errorMessage(e)}`]
  }
  if (lines.length === 0) {
    return undefined
  }
  return notify(lines.join('\n'))
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
