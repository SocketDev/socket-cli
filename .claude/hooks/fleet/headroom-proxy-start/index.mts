#!/usr/bin/env node
// Claude Code SessionStart hook — headroom-ai proxy auto-start.
//
// Probes localhost:7779 for a healthy headroom proxy. If absent, spawns the
// installed `bin/headroom proxy` in the background and waits for /health. Only
// writes `export ANTHROPIC_BASE_URL=…` to $CLAUDE_ENV_FILE if the proxy is
// verified healthy. headroom is the AI context-compression proxy that fully
// REPLACED the removed socket-token-minifier, reusing its :7779 port so the
// fleet-canonical ANTHROPIC_BASE_URL is unchanged across the cutover.
//
// 🔒 The spawned `bin/headroom` is the LOCKDOWN WRAPPER (setup-security-tools/
// lib/headroom.mts): it exports HEADROOM_TELEMETRY=off + HEADROOM_TELEMETRY_WARN
// =off + HF_HUB_OFFLINE=1 before exec, so the telemetry beacon + the HuggingFace
// model fetch are off. `--no-telemetry` is passed too (belt). Enforced by
// scripts/fleet/check/headroom-is-telemetry-locked-down.mts. Audit:
// .claude/reports/headroom-telemetry-audit.md.
//
// **Fail-closed**: if the binary isn't installed, the port is taken by something
// else, or the spawn doesn't come up healthy in the budget, the hook exits 0
// with no env-var write — Claude Code routes direct to api.anthropic.com (no
// compression, no breakage). The only failure mode this prevents is the worse
// one: setting ANTHROPIC_BASE_URL unconditionally and breaking every session
// whose proxy isn't running.
//
// Time budget: ~3 seconds total — anything slower holds the SessionStart chain.

import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { appendFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'

const logger = getDefaultLogger()

// Customizable via the HEADROOM_PROXY_PORT env var; defaults to 7779 (the
// legacy token-minifier port headroom replaced, so the fleet-canonical
// ANTHROPIC_BASE_URL is unchanged). An empty/invalid value falls back to 7779.
// PROXY_ARGS + ANTHROPIC_BASE_URL below derive from it, so one override repoints
// the whole hook.
const PROXY_PORT = Number(process.env['HEADROOM_PROXY_PORT']) || 7779
const HEALTH_URL = `http://localhost:${PROXY_PORT}/health`
// The lockdown wrapper installed by setup-security-tools (rack/bin handle over
// the _dlx/<hash> venv). Running it forces telemetry + model fetch off.
const BIN_PATH = path.join(getSocketAppDir('wheelhouse'), 'bin', 'headroom')
// `headroom proxy` args. --no-telemetry is belt — the wrapper already exports
// HEADROOM_TELEMETRY=off.
const PROXY_ARGS = ['proxy', '--port', String(PROXY_PORT), '--no-telemetry']
const ANTHROPIC_BASE_URL = `http://localhost:${PROXY_PORT}`
// The substring that identifies OUR proxy in a port-holder's command line, so
// reapWedgedProxy never kills an unrelated service.
const PROXY_CMD_MARKER = 'headroom'

const PROBE_TIMEOUT_MS = 250
const SPAWN_WAIT_BUDGET_MS = 2500
const SPAWN_POLL_INTERVAL_MS = 100

/**
 * Emit additionalContext (visible in the transcript) so a user skimming the
 * session log sees what the hook did. Optional — Claude Code reads it as
 * informational text, not as an action.
 */
export function emitSessionStartContext(message: string): void {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[headroom] ${message}`,
    },
  }
  process.stdout.write(JSON.stringify(out))
}

interface ProbeOutcome {
  healthy: boolean
  /**
   * Undefined when probe couldn't connect (proxy absent); defined when
   * something else returned.
   */
  status?: number | undefined
}

/**
 * One-shot HTTP GET to /health. Resolves to {healthy: true} only on 2xx —
 * anything else (connection refused, timeout, wrong content, non-2xx status) is
 * treated as not-healthy. Fail-closed at this layer keeps the env-var write
 * conditional on actual liveness.
 */
export function probeHealth(): Promise<ProbeOutcome> {
  return new Promise(resolve => {
    const req = http.get(HEALTH_URL, { timeout: PROBE_TIMEOUT_MS }, res => {
      /* c8 ignore start - statusCode is always defined for real HTTP responses; ?? 0 is a defensive fallback */
      const status = res.statusCode ?? 0
      /* c8 ignore stop */
      // Drain body so the socket can be reused / closed cleanly.
      res.resume()
      resolve({ healthy: status >= 200 && status < 300, status })
    })
    /* c8 ignore start - error/timeout arms require a real network failure against localhost:7779 */
    req.on('error', () => resolve({ healthy: false }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ healthy: false })
    })
    /* c8 ignore stop */
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Spawn the proxy detached so it survives this hook exit. stdio disconnected so
 * any startup logs don't leak into Claude Code's session output. BIN_PATH is
 * the lockdown wrapper, so the spawned proxy has telemetry + model fetch forced
 * off.
 */
/* c8 ignore start - spawnDetached spawns the real headroom binary at BIN_PATH; requires the installed binary on disk and is only called from c8-ignored main() */
export function spawnDetached(): void {
  // The lib's spawn returns a thenable-with-extras shape: it has the promise
  // interface AND a `process: ChildProcess` field. We don't await — we just
  // unref() the underlying ChildProcess so SIGTERM / exit signals don't cascade
  // into the proxy.
  const result = spawn(BIN_PATH, PROXY_ARGS, {
    detached: true,
    // Output-token compression (the received direction): a terseness
    // system-prompt note + effort-down on trivial tool-result-resume turns
    // (new questions/errors keep full effort). Input/context compression is
    // already default-on; this turns on the output side too.
    env: { ...process.env, HEADROOM_OUTPUT_SHAPER: '1' },
    stdio: 'ignore',
  })
  result.process.unref()
}
/* c8 ignore stop */

/**
 * Find PIDs listening on PROXY_PORT whose command line identifies them as OUR
 * proxy (the headroom binary), and SIGKILL them.
 *
 * Used when the port is held but /health is failing — a wedged or hung proxy
 * from an earlier session. TWO independent safety gates so a HEALTHY shared
 * proxy (one another session is using) is never killed:
 *
 * 1. Re-probe /health first and bail if it's healthy — closes the TOCTOU window
 *    between the caller's probe and this kill.
 * 2. Only kill a PID whose command matches `headroom`, so an unrelated service
 *    holding the port is never touched. Best-effort; any error is swallowed so
 *    the hook never blocks session start.
 *
 * Returns the number of stale instances killed.
 */
/* c8 ignore start - reapWedgedProxy body depends on machine state: probeHealth hits a live localhost port, then lsof/ps/kill require real PIDs — none controllable in-process */
export async function reapWedgedProxy(): Promise<number> {
  // Gate 1: never kill a healthy proxy.
  const probe = await probeHealth()
  if (probe.healthy) {
    return 0
  }
  let killed = 0
  try {
    const lsof = spawnSync('lsof', ['-ti', `tcp:${PROXY_PORT}`], {
      encoding: 'utf8',
    })
    const pids = String(lsof.stdout ?? '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    for (const pid of pids) {
      const pidNum = Number(pid)
      if (!Number.isInteger(pidNum) || pidNum <= 1) {
        continue
      }
      // Gate 2: confirm this PID is actually our proxy before killing it.
      const ps = spawnSync('ps', ['-o', 'command=', '-p', pid], {
        encoding: 'utf8',
      })
      const command = String(ps.stdout ?? '')
      if (!command.includes(PROXY_CMD_MARKER)) {
        continue
      }
      try {
        process.kill(pidNum, 'SIGKILL')
        killed += 1
      } catch {
        // Already gone, or no permission — skip.
      }
    }
  } catch {
    // lsof missing / unexpected failure — fail-closed, reap nothing.
  }
  return killed
}
/* c8 ignore stop */

/**
 * Append `export ANTHROPIC_BASE_URL=...` to CLAUDE_ENV_FILE so the session env
 * picks it up. If the file isn't set OR isn't writable, fail-closed silently —
 * the env var stays unset and Claude Code falls back to direct
 * api.anthropic.com.
 */
export function writeAnthropicBaseUrlToEnvFile(): void {
  const envFile = process.env['CLAUDE_ENV_FILE']
  if (!envFile) {
    return
  }
  const line = `export ANTHROPIC_BASE_URL='${ANTHROPIC_BASE_URL}'\n`
  try {
    // Append, don't overwrite — other hooks may also be writing.
    appendFileSync(envFile, line, 'utf8')
  } catch {
    // Fail-closed: if we can't write, don't set the env var. Session goes direct.
  }
}

/* c8 ignore start - main() orchestrates real machine state: live probeHealth, existsSync(BIN_PATH), spawnDetached, and a polling loop — none controllable in-process */
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

  // (2) Port responded, but not healthy — reap OUR wedged instance if that's
  // what holds it; otherwise the port belongs to something else (fail-closed).
  if (initial.status !== undefined) {
    const reaped = await reapWedgedProxy()
    if (reaped === 0) {
      emitSessionStartContext(
        `port ${PROXY_PORT} responded with status ${initial.status} (not our proxy); skipping.`,
      )
      return
    }
    emitSessionStartContext(
      `reaped ${reaped} wedged proxy instance(s) on :${PROXY_PORT}; restarting.`,
    )
  }

  // (3) Binary installed?
  if (!existsSync(BIN_PATH)) {
    emitSessionStartContext(
      `binary not found at ${BIN_PATH}; run \`pnpm run setup-security-tools\` (installs headroom). ` +
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
        `started proxy on :${PROXY_PORT} (telemetry + model fetch locked off); ANTHROPIC_BASE_URL set.`,
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
/* c8 ignore stop */

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// imports this module for its pure helpers (else the proxy-reap side effects
// fire on import inside the node --test runner).
/* c8 ignore next - entrypoint guard only fires when the script is run directly */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  /* c8 ignore start - direct-invocation body: logger + process.exit only reachable when run as a CLI */
  main().catch(e => {
    logger.fail(`headroom-proxy-start hook error: ${String(e)}`)
    process.exit(0)
  })
  /* c8 ignore stop */
}
