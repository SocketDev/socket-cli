#!/usr/bin/env node
/**
 * @fileoverview User-invoked installer / health-fixer for the Socket
 * security tools (AgentShield, Zizmor, SFW).
 *
 * Runs interactively. Differs from `index.mts` (the Stop hook):
 *
 *   - This script PROMPTS for missing config (e.g. SOCKET_API_TOKEN)
 *     and persists to the OS keychain.
 *   - It DOWNLOADS missing or stale binaries.
 *   - It REPAIRS broken SFW shims (entries pointing to dlx-cache
 *     hashes that no longer exist on disk).
 *
 * The Stop hook only DETECTS and REPORTS. Auto-prompting / auto-
 * downloading from a Stop hook would surprise the operator with
 * network calls + interactive flows mid-conversation.
 *
 * Skips the interactive prompt path when:
 *   - Running in CI (`getCI()` from @socketsecurity/lib-stable/env/ci).
 *   - Stdin isn't a TTY (`!process.stdin.isTTY`).
 *
 * In those skip cases, the script falls back to sfw-free (the auth-
 * free SFW build) and continues without persisting a token.
 *
 * Invocation:
 *   node .claude/hooks/setup-security-tools/install.mts
 *   node .claude/hooks/setup-security-tools/install.mts --rotate
 *
 * Flags:
 *   --rotate           Re-prompt for SOCKET_API_TOKEN and overwrite the
 *                      keychain entry, ignoring env/.env/keychain lookup.
 *                      Use to rotate a leaked or expired token without
 *                      manually clearing the keychain first.
 *   --update-token     Alias for --rotate.
 *
 * Exit codes:
 *   0 — all tools installed + verified.
 *   1 — at least one tool failed; details on stderr.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { findApiToken } from './lib/api-token.mts'
import { installShellRcBridge } from './lib/shell-rc-bridge.mts'
import type { BridgeWriteResult } from './lib/shell-rc-bridge.mts'
import {
  keychainAvailable,
  writeTokenToKeychain,
} from './lib/token-storage.mts'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Read a secret from the TTY without echoing it. Wraps node:readline
 * with custom output muting — typed characters never appear on
 * screen and never end up in shell history.
 *
 * Caller must verify `process.stdin.isTTY` before invoking.
 */
async function promptSecret(prompt: string): Promise<string> {
  // Custom output stream that swallows everything written to stdout
  // during the prompt — that's how readline echoes typed characters,
  // and we want them invisible.
  const muted = new (class extends (await import('node:stream')).Writable {
    override _write(_chunk: unknown, _enc: unknown, cb: () => void): void {
      cb()
    }
  })()
  const rl = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  })
  // The prompt itself is written directly to stderr so it shows up
  // even though readline's echo is muted.
  process.stderr.write(prompt)
  try {
    return await new Promise<string>(resolve => {
      rl.question('', answer => {
        process.stderr.write('\n')
        resolve(answer.trim())
      })
    })
  } finally {
    rl.close()
  }
}

/**
 * Walk an existing SFW shim and report whether its dlx-cached
 * binary target still exists. A shim is "broken" when the dlx
 * cache has been evicted (cleanup script, manual delete, manifest
 * rebuild) and the shim points at a path that no longer resolves.
 */
async function findBrokenShims(): Promise<string[]> {
  const shimsDir = path.join(
    process.env['HOME'] ?? '',
    '.socket',
    'sfw',
    'shims',
  )
  if (!existsSync(shimsDir)) {
    return []
  }
  const broken: string[] = []
  const entries = await fs.readdir(shimsDir)
  for (const entry of entries) {
    const shimPath = path.join(shimsDir, entry)
    let content: string
    try {
      content = await fs.readFile(shimPath, 'utf8')
    } catch {
      continue
    }
    // Each shim has the form: exec "<dlx-path>/sfw-{free,enterprise}" ...
    // Pull out the dlx target and check existsSync.
    const m = content.match(/"([^"]*\/_dlx\/[^"]+\/sfw-(?:free|enterprise))"/)
    if (!m) {
      continue
    }
    const target = m[1]!
    if (!existsSync(target)) {
      broken.push(entry)
    }
  }
  return broken
}

/**
 * Shared prompt-and-persist body used by both the "no token found" and
 * the explicit `--rotate` paths. The `reason` strings differ but the
 * gating + the prompt + the keychain write are identical.
 */
async function promptAndPersist(
  reason: 'missing' | 'rotate',
): Promise<string | undefined> {
  if (getCI()) {
    logger.log(
      'CI environment detected — skipping the SOCKET_API_TOKEN prompt. ' +
        'Falling back to sfw-free.',
    )
    return undefined
  }
  if (!process.stdin.isTTY) {
    logger.log(
      'No TTY — skipping the SOCKET_API_TOKEN prompt. ' +
        'Falling back to sfw-free. Set SOCKET_API_TOKEN in env or run ' +
        'this script interactively to persist it to the OS keychain.',
    )
    return undefined
  }
  const kc = keychainAvailable()
  if (!kc.available) {
    logger.warn(
      `OS keychain tool '${kc.toolName}' is not available. ${
        kc.installHint ?? ''
      }`,
    )
    logger.log('Falling back to sfw-free.')
    return undefined
  }
  logger.log('')
  if (reason === 'rotate') {
    logger.log(
      `Rotating SOCKET_API_TOKEN — the keychain entry will be overwritten ` +
        `via ${kc.toolName}.`,
    )
  } else {
    logger.log('Socket API token not found in env, .env, or the OS keychain.')
    logger.log(
      'A token unlocks sfw-enterprise (org-aware malware scanning). ' +
        `It will be stored securely via ${kc.toolName}.`,
    )
  }
  logger.log(
    "Get a token at https://socket.dev/dashboard or press Enter to skip" +
      (reason === 'rotate'
        ? ' (the existing keychain entry stays in place).'
        : ' and use sfw-free.'),
  )
  logger.log('')
  const answer = await promptSecret('SOCKET_API_TOKEN (input hidden): ')
  if (!answer) {
    if (reason === 'rotate') {
      logger.log('No token entered. Keychain unchanged.')
    } else {
      logger.log('No token entered. Falling back to sfw-free.')
    }
    return undefined
  }
  try {
    writeTokenToKeychain(answer)
    if (reason === 'rotate') {
      logger.success(`SOCKET_API_TOKEN rotated and persisted via ${kc.toolName}.`)
    }
  } catch (e) {
    logger.error(
      `Failed to persist token to keychain: ${(e as Error).message}. ` +
        'Continuing with the value for this session only — it will not ' +
        'persist across runs until the keychain tool is available.',
    )
  }
  return answer
}

/**
 * Write (or refresh) the keychain → shell-env bridge block in the
 * user's shell rc. Idempotent: re-running install.mts on an already-
 * wired rc is a no-op. Called from main() on every invocation so the
 * bridge gets installed whether or not the user just entered a fresh
 * token via the prompt — keychain hits from env/.env/keychain still
 * need the bridge to actually reach the shell of every NEW session.
 */
function wireBridgeIntoShellRc(token: string): void {
  try {
    const bridge = installShellRcBridge(token)
    reportBridgeOutcome(bridge)
  } catch (e) {
    logger.warn(
      `Failed to write the shell-rc env block: ${(e as Error).message}. ` +
        'You will need to export SOCKET_API_KEY manually for sfw to pick it up.',
    )
  }
}

/**
 * Print a one-paragraph summary of what the shell-rc bridge did (or
 * didn't do), with a copy-pasteable next step. Splitting this out
 * keeps `promptAndPersist` readable and gives the rotate path the
 * same instruction without duplicating the prose.
 */
function reportBridgeOutcome(bridge: BridgeWriteResult | undefined): void {
  if (!bridge) {
    // Non-macOS or no rc detectable — fall through to a manual line
    // the user can paste. We hand the user a literal-export template
    // (not a keychain-read) because re-reading the keychain on every
    // shell triggers an auth prompt on macOS.
    logger.log('')
    logger.log(
      'Add this to your shell rc / .zshenv so SOCKET_API_KEY/TOKEN ' +
        'are exported each session (sfw + older socket-cli builds ' +
        'read SOCKET_API_KEY):',
    )
    logger.log("  export SOCKET_API_TOKEN='<your-token>'")
    logger.log('  export SOCKET_API_KEY="$SOCKET_API_TOKEN"')
    return
  }
  if (bridge.outcome === 'unchanged') {
    logger.log(
      `Shell-rc env block already canonical at ${bridge.rcPath} — no change.`,
    )
  } else if (bridge.outcome === 'updated') {
    logger.success(
      `Updated the shell-rc env block at ${bridge.rcPath}. ` +
        'Run `source ' +
        bridge.rcPath +
        '` (or open a new shell) so SOCKET_API_KEY/TOKEN get exported.',
    )
  } else {
    logger.success(
      `Wrote the shell-rc env block to ${bridge.rcPath}. ` +
        'Run `source ' +
        bridge.rcPath +
        '` (or open a new shell) so SOCKET_API_KEY/TOKEN get exported.',
    )
  }
}

async function offerTokenPrompt(): Promise<string | undefined> {
  return promptAndPersist('missing')
}

interface CliArgs {
  rotate: boolean
}

function parseArgs(argv: readonly string[]): CliArgs {
  let rotate = false
  for (const arg of argv) {
    if (arg === '--rotate' || arg === '--update-token') {
      rotate = true
    }
  }
  return { rotate }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  logger.log('Socket security tools — install / verify\n')

  let apiToken: string | undefined
  if (args.rotate) {
    // Rotation path: skip the lookup so a stale env/.env doesn't
    // short-circuit the re-prompt, and overwrite the keychain entry
    // unconditionally. If the user presses Enter without typing, the
    // existing keychain value stays in place — we fall through to the
    // normal lookup below so downstream installers still get the
    // pre-rotation token.
    const fresh = await promptAndPersist('rotate')
    if (fresh) {
      apiToken = fresh
    } else {
      const lookup = findApiToken()
      apiToken = lookup.token
      if (apiToken && lookup.source) {
        logger.log(`Keeping existing SOCKET_API_TOKEN (via ${lookup.source}).`)
      }
    }
  } else {
    // Existing token state — env > .env > keychain.
    const lookup = findApiToken()
    apiToken = lookup.token
    if (apiToken && lookup.source) {
      logger.log(`SOCKET_API_TOKEN: found via ${lookup.source}.`)
    } else {
      apiToken = await offerTokenPrompt()
    }
  }

  // Wire the literal token into the shell rc unconditionally. The
  // token may have come from env/.env/keychain (no prompt fired) —
  // without this block, every NEW shell session launches with an
  // empty SOCKET_API_KEY and the sfw shim returns 401. We embed the
  // token VALUE directly in the rc instead of calling `security
  // find-generic-password` from the shell, because the latter
  // triggers a macOS Keychain auth prompt on every new shell
  // (Claude Code's Bash tool spawns one per command — see the
  // 2026-05-15 incident memory). Idempotent: same-value re-run is
  // outcome=unchanged. Rotate writes a fresh block.
  if (apiToken) {
    wireBridgeIntoShellRc(apiToken)
  }

  // Broken-shim detection. When the dlx cache rotates (cleanup, manifest
  // rebuild, manual deletion), shims keep pointing at the old hash and
  // every shimmed command fails with "No such file or directory."
  // Repair = reinstall SFW, which rewrites the shims at the new hash.
  const broken = await findBrokenShims()
  if (broken.length > 0) {
    logger.warn(
      `Found ${broken.length} broken SFW shim(s): ${broken.join(', ')}. ` +
        'These point to a dlx-cache target that no longer exists. ' +
        'Reinstalling SFW will rewrite the shims.',
    )
  }

  // Hand off to the original installer modules. We re-export the
  // three setup* functions from index.mts so install.mts owns the
  // orchestration + this script just sequences them.
  const installers = (await import('./lib/installers.mts')) as {
    setupAgentShield: () => Promise<boolean>
    setupZizmor: () => Promise<boolean>
    setupSfw: (apiToken: string | undefined) => Promise<boolean>
  }

  const agentshieldOk = await installers.setupAgentShield()
  logger.log('')
  const zizmorOk = await installers.setupZizmor()
  logger.log('')
  const sfwOk = await installers.setupSfw(apiToken)
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`AgentShield: ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`Zizmor:      ${zizmorOk ? 'ready' : 'FAILED'}`)
  logger.log(`SFW:         ${sfwOk ? 'ready' : 'FAILED'}`)

  if (agentshieldOk && zizmorOk && sfwOk) {
    logger.log('\nAll security tools ready.')
  } else {
    logger.warn('\nSome tools not available. See above.')
    process.exitCode = 1
  }
}

void __dirname

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(`setup-security-tools install: ${msg}`)
  process.exitCode = 1
})
