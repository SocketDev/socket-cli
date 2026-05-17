#!/usr/bin/env node
// Claude Code Stop hook — auth-rotation-reminder.
//
// Periodically logs you out of authenticated CLIs (npm, pnpm, gcloud,
// vault, aws sso, docker, socket, …) so stale long-lived tokens don't
// sit in dotfiles or keychains for days.
//
// Behavior on each Stop event:
//
//   1. Drain stdin (Stop hook delivers a JSON payload we don't need).
//   2. Skip if running in CI (CI auth has its own lifecycle).
//   3. Read both global + project-local `.snooze` files. Each carries
//      an ISO 8601 expiry on line 1; if past, the file is auto-cleaned
//      and the hook proceeds. If unexpired, the hook honors the snooze
//      and exits silently.
//   4. Throttle via a state file: if the last successful run was within
//      the configured interval (default 1h), exit silently.
//   5. For each service in services.mts:
//        a. Skip if the binary is missing and `optional: true`.
//        b. Run detectCmd. Skip if not authenticated.
//        c. Run logoutCmd. Log to stderr via lib's logger.
//   6. Update the state file's mtime.
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
//     How long between actual auth-rotation runs (state-file throttle).
//     Set to 0 to run on every Stop event (verbose).
//
//   SOCKET_AUTH_ROTATION_DISABLED        default: unset
//     If set to a truthy value, skip the hook entirely.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeDelete } from '@socketsecurity/lib-stable/fs'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import {
  readLastAssistantText,
  stripCodeFences,
} from '../_shared/transcript.mts'

import { DEFAULT_SKIP_IDS, SERVICES } from './services.mts'
import type { Service } from './services.mts'

const logger = getDefaultLogger()
const PREFIX = '[auth-rotation-reminder]'

// ── Paths ───────────────────────────────────────────────────────────

const STATE_DIR = path.join(homedir(), '.claude', 'hooks', 'auth-rotation')
const STATE_FILE = path.join(STATE_DIR, 'last-run')
const GLOBAL_SNOOZE = path.join(STATE_DIR, 'snooze')
const GLOBAL_SKIP_LIST = path.join(STATE_DIR, 'services-skip')

// Project-local files live at the repo root next to .claude/. Use
// CLAUDE_PROJECT_DIR (Claude Code injects this on every hook run) so
// the paths stay correct regardless of session cwd — process.cwd()
// drifts when the user navigates into a subpackage.
const PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const PROJECT_SNOOZE = path.join(
  PROJECT_DIR,
  '.claude',
  'auth-rotation.snooze',
)
const PROJECT_SKIP_LIST = path.join(
  PROJECT_DIR,
  '.claude',
  'auth-rotation.services-skip',
)

// ── Snooze handling ─────────────────────────────────────────────────

interface SnoozeStatus {
  active: boolean
  cleaned: string[]
}

async function checkSnoozes(): Promise<SnoozeStatus> {
  const status: SnoozeStatus = { active: false, cleaned: [] }
  const cleanFile = async (file: string, reason: string): Promise<void> => {
    try {
      await safeDelete(file)
      status.cleaned.push(file)
    } catch (e) {
      logger.error(
        `${PREFIX} safeDelete(${path.basename(file)}) failed (${reason}): ${errorMessage(e)}`,
      )
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

function loadSkipIds(): Set<string> {
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
// its own output. Bypass the throttle when any of these fire so the
// rotation happens immediately, not in the next 1h tick.
//
// The patterns target the WARNING text (i.e., what the assistant
// said about a leak), not the token value itself. token-guard handles
// pre-leak blocking; this is "the leak happened, surface it now."
const LEAK_WARNING_PATTERNS: ReadonlyArray<RegExp> = [
  /\brotate the token\b/i,
  /\brotate (?:the )?(?:api )?key\b/i,
  /\bleaked into (?:the )?transcript\b/i,
  /\btoken (?:value )?(?:was )?(?:briefly )?visible (?:to me )?(?:at one point )?(?:in )?(?:the )?(?:tool output|transcript|context)\b/i,
  // Bright-red rotation banner shape the security-incident block uses.
  /[⚠️!]+\s*Rotate the token\b/i,
  // "appears in transcript" / "in conversation transcript"
  /\b(?:appeared|present|exposed) in (?:the )?(?:conversation )?transcript\b/i,
  // "security incident notice" — used by my Token-Hygiene memory
  // template when surfacing a leak.
  /\bsecurity incident notice\b/i,
]

interface LeakDetection {
  triggered: boolean
  matchedPattern: string | undefined
}

/**
 * Scan the most-recent assistant turn (from the Stop-hook JSON
 * payload's transcript_path) for a leak-warning marker. Returns
 * `triggered: true` when any pattern hits — caller bypasses the
 * throttle and runs rotation immediately.
 *
 * Caller passes in the raw stdin payload because `main()` already
 * captured it (Node's stdin is single-use).
 */
function detectLeakWarning(stdinPayload: string): LeakDetection {
  if (!stdinPayload) {
    return { triggered: false, matchedPattern: undefined }
  }
  let payload: { transcript_path?: string }
  try {
    payload = JSON.parse(stdinPayload) as { transcript_path?: string }
  } catch {
    return { triggered: false, matchedPattern: undefined }
  }
  let text: string
  try {
    text = readLastAssistantText(payload.transcript_path) ?? ''
  } catch {
    return { triggered: false, matchedPattern: undefined }
  }
  if (!text) {
    return { triggered: false, matchedPattern: undefined }
  }
  // Strip code fences so a regex matching inside an example block
  // doesn't fire (those are docs / show-don't-tell, not incidents).
  const stripped = stripCodeFences(text)
  for (const pat of LEAK_WARNING_PATTERNS) {
    const m = stripped.match(pat)
    if (m) {
      return { triggered: true, matchedPattern: m[0] }
    }
  }
  return { triggered: false, matchedPattern: undefined }
}

// ── Throttle ────────────────────────────────────────────────────────

function intervalMs(): number {
  const raw = process.env['SOCKET_AUTH_ROTATION_INTERVAL_HOURS']
  const hours = raw === undefined ? 1 : Number.parseFloat(raw)
  if (!Number.isFinite(hours) || hours < 0) {
    return 60 * 60 * 1000
  }
  return Math.round(hours * 60 * 60 * 1000)
}

function withinThrottle(): boolean {
  const interval = intervalMs()
  if (interval === 0) {
    return false
  }
  if (!existsSync(STATE_FILE)) {
    return false
  }
  try {
    const { mtimeMs } = statSync(STATE_FILE)
    return Date.now() - mtimeMs < interval
  } catch {
    return false
  }
}

function touchStateFile(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    if (!existsSync(STATE_FILE)) {
      writeFileSync(STATE_FILE, '')
    }
    const now = new Date()
    utimesSync(STATE_FILE, now, now)
  } catch {
    // Throttle is best-effort. Loss = hook runs more often than configured;
    // not worth surfacing.
  }
}

// ── Service detection + logout ──────────────────────────────────────

interface RotationResult {
  loggedOut: string[]
  failed: Array<{ service: string; reason: string }>
  skippedMissing: string[]
}

function isOnPath(binary: string): boolean {
  // `command -v` is portable across sh/bash/zsh and exits 0 if found.
  const r = spawnSync('sh', ['-c', `command -v ${binary} >/dev/null 2>&1`], {
    stdio: 'ignore',
  })
  return r.status === 0
}

function isAuthenticated(s: Service): boolean {
  const r = spawnSync(s.detectCmd[0]!, s.detectCmd.slice(1) as string[], {
    stdio: 'ignore',
    timeout: 5000,
  })
  return r.status === 0
}

function runLogout(s: Service): { ok: boolean; reason?: string } {
  const r = spawnSync(s.logoutCmd[0]!, s.logoutCmd.slice(1) as string[], {
    stdio: 'ignore',
    timeout: 10_000,
  })
  if (r.status === 0) {
    return { ok: true }
  }
  if (r.error) {
    return { ok: false, reason: r.error.message }
  }
  return { ok: false, reason: `exit code ${r.status}` }
}

function rotateAll(skipIds: Set<string>): RotationResult {
  const result: RotationResult = {
    loggedOut: [],
    failed: [],
    skippedMissing: [],
  }
  for (const service of SERVICES) {
    if (skipIds.has(service.id)) {
      continue
    }
    if (!isOnPath(service.detectCmd[0]!)) {
      if (!service.optional) {
        result.skippedMissing.push(service.name)
      }
      continue
    }
    if (!isAuthenticated(service)) {
      continue
    }
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
  return result
}

// ── Output ──────────────────────────────────────────────────────────

function reportSnoozeCleaned(cleaned: string[]): void {
  for (const file of cleaned) {
    logger.error(`${PREFIX} cleared expired snooze: ${file}`)
  }
}

function reportRotation(result: RotationResult): void {
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
    return
  }
  logger.error(`${PREFIX} ${parts.join('; ')}`)
  logger.error(
    `  Snooze for next 4h:  date -ud "+4 hours" +"%Y-%m-%dT%H:%M:%SZ" > .claude/auth-rotation.snooze`,
  )
}

// ── Main ────────────────────────────────────────────────────────────

async function run(stdinPayload: string): Promise<void> {
  if (process.env['CI']) {
    return
  }
  if (process.env['SOCKET_AUTH_ROTATION_DISABLED']) {
    return
  }
  const snooze = await checkSnoozes()
  reportSnoozeCleaned(snooze.cleaned)
  if (snooze.active) {
    return
  }
  // Inspect the most-recent assistant turn for a leak-warning marker.
  // When the assistant just said "rotate the token" / "leaked into
  // transcript", bypass the throttle so rotation runs immediately
  // instead of waiting for the next 1h tick.
  const leak = detectLeakWarning(stdinPayload)
  if (leak.triggered) {
    logger.error(
      `${PREFIX} leak warning detected in assistant output ("${leak.matchedPattern}"); bypassing throttle`,
    )
  } else if (withinThrottle()) {
    return
  }
  const skipIds = loadSkipIds()
  const result = rotateAll(skipIds)
  reportRotation(result)
  touchStateFile()
}

function main(): void {
  // Capture stdin so detectLeakWarning() can scan the Stop-hook
  // payload (JSON with transcript_path). We previously drained
  // without reading; now we accumulate and pass to run().
  let stdinPayload = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    stdinPayload += chunk
  })
  process.stdin.on('end', () => {
    run(stdinPayload)
      .catch(e => {
        logger.error(`${PREFIX} unexpected error: ${errorMessage(e)}`)
      })
      .finally(() => {
        process.exit(0)
      })
  })
  if (process.stdin.readable === false) {
    run('')
      .catch(e => {
        logger.error(`${PREFIX} unexpected error: ${errorMessage(e)}`)
      })
      .finally(() => {
        process.exit(0)
      })
  }
}

main()
