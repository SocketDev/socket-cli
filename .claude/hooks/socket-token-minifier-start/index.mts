#!/usr/bin/env node
// Claude Code SessionStart hook — socket-token-minifier auto-start.
//
// Probes localhost:7779 for a healthy socket-token-minifier proxy.
// If absent, spawns the installed binary in the background and waits
// for /health to respond. Only writes `export ANTHROPIC_BASE_URL=…`
// to $CLAUDE_ENV_FILE if the proxy is verified healthy.
//
// **Fail-closed**: if the binary isn't installed, the port is taken
// by something else, or the spawn fails to come up healthy in the
// time budget, the hook exits 0 with no env-var write. Claude Code
// then routes direct to api.anthropic.com — no compression, no
// breakage. The only failure mode this hook prevents is the worse
// one: setting ANTHROPIC_BASE_URL unconditionally and breaking
// every session whose proxy isn't running.
//
// Time budget: ~3 seconds total. Anything slower than that holds the
// SessionStart hook chain and the user feels it.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'

const logger = getDefaultLogger()

const PROXY_PORT = 7779
const HEALTH_URL = `http://localhost:${PROXY_PORT}/health`
const BIN_PATH = path.join(getSocketAppDir('wheelhouse'), 'bin', 'socket-token-minifier')
const ANTHROPIC_BASE_URL = `http://localhost:${PROXY_PORT}`

const PROBE_TIMEOUT_MS = 250
const SPAWN_WAIT_BUDGET_MS = 2500
const SPAWN_POLL_INTERVAL_MS = 100

interface ProbeOutcome {
  healthy: boolean
  /** undefined when probe couldn't connect (proxy absent); defined when something else returned). */
  status?: number
}

/**
 * One-shot HTTP GET to /health. Resolves to {healthy: true} only on
 * 2xx — anything else (connection refused, timeout, wrong content,
 * non-2xx status) is treated as not-healthy. Fail-closed at this
 * layer keeps the env-var write conditional on actual liveness.
 */
function probeHealth(): Promise<ProbeOutcome> {
  return new Promise(resolve => {
    const req = http.get(HEALTH_URL, { timeout: PROBE_TIMEOUT_MS }, res => {
      const status = res.statusCode ?? 0
      // Drain body so the socket can be reused / closed cleanly.
      res.resume()
      resolve({ healthy: status >= 200 && status < 300, status })
    })
    req.on('error', () => resolve({ healthy: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ healthy: false })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Spawn the proxy detached so it survives this hook exit. stdio
 * disconnected so any startup logs don't leak into Claude Code's
 * session output.
 */
function spawnDetached(): void {
  const child = spawn(BIN_PATH, [], {
    detached: true,
    stdio: 'ignore',
  })
  // Detach from this process group so SIGTERM / exit signals don't
  // cascade into the proxy.
  child.unref()
}

/**
 * Emit additionalContext (visible in the transcript) so a user
 * skimming the session log sees what the hook did. Optional — Claude
 * Code reads it as informational text, not as an action.
 */
function emitSessionStartContext(message: string): void {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[socket-token-minifier] ${message}`,
    },
  }
  process.stdout.write(JSON.stringify(out))
}

/**
 * Append `export ANTHROPIC_BASE_URL=...` to CLAUDE_ENV_FILE so the
 * session env picks it up. Claude Code reads the file when assembling
 * its child-process env (per claude-code/src/utils/sessionEnvironment.ts).
 *
 * If the file isn't set OR isn't writable, fail-closed silently —
 * the env var stays unset and Claude Code falls back to direct
 * api.anthropic.com.
 */
function writeAnthropicBaseUrlToEnvFile(): void {
  const envFile = process.env['CLAUDE_ENV_FILE']
  if (!envFile) return
  // Quote single-quoted POSIX style. The value is a known-safe URL,
  // but quote anyway for consistency with hooks that take user input.
  const line = `export ANTHROPIC_BASE_URL='${ANTHROPIC_BASE_URL}'\n`
  try {
    // Append, don't overwrite — other hooks may also be writing.
    // Use sync fs since this is a small write on a hot path (hook
    // runtime is part of session-start latency).
    const fs = require('node:fs') as typeof import('node:fs')
    fs.appendFileSync(envFile, line, 'utf8')
  } catch {
    // Fail-closed: if we can't write, don't set the env var. Session
    // goes direct.
  }
}

async function main(): Promise<void> {
  // (1) Already running?
  const initial = await probeHealth()
  if (initial.healthy) {
    writeAnthropicBaseUrlToEnvFile()
    emitSessionStartContext(
      `proxy already healthy on :${PROXY_PORT}; ANTHROPIC_BASE_URL set.`,
    )
    return
  }

  // (2) Port taken by something we don't recognize? If so, fail-closed —
  // we don't want to clobber whatever is listening.
  if (initial.status !== undefined) {
    emitSessionStartContext(
      `port ${PROXY_PORT} responded with status ${initial.status} (not our proxy); skipping.`,
    )
    return
  }

  // (3) Binary installed?
  if (!existsSync(BIN_PATH)) {
    emitSessionStartContext(
      `binary not found at ${BIN_PATH}; run \`pnpm run install-token-minifier\`. ` +
        `Continuing with direct api.anthropic.com.`,
    )
    return
  }

  // (4) Start it + wait for health.
  spawnDetached()
  const deadline = Date.now() + SPAWN_WAIT_BUDGET_MS
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_INTERVAL_MS)
    const probe = await probeHealth()
    if (probe.healthy) {
      writeAnthropicBaseUrlToEnvFile()
      emitSessionStartContext(
        `started proxy on :${PROXY_PORT}; ANTHROPIC_BASE_URL set.`,
      )
      return
    }
  }

  // Spawn fired but didn't come healthy in the budget. Fail-closed.
  emitSessionStartContext(
    `proxy failed to become healthy within ${SPAWN_WAIT_BUDGET_MS}ms; ` +
      `continuing with direct api.anthropic.com.`,
  )
}

main().catch(e => {
  // Internal-error fail-closed: never block session start. Log to
  // stderr so a noisy install issue is at least visible.
  logger.fail(`socket-token-minifier-start hook error: ${String(e)}`)
  process.exit(0)
})
