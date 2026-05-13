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

async function offerTokenPrompt(): Promise<string | undefined> {
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
  logger.log('Socket API token not found in env, .env, or the OS keychain.')
  logger.log(
    'A token unlocks sfw-enterprise (org-aware malware scanning). ' +
      `It will be stored securely via ${kc.toolName}.`,
  )
  logger.log(
    "Get a token at https://socket.dev/dashboard or press Enter to skip and use sfw-free.",
  )
  logger.log('')
  const answer = await promptSecret('SOCKET_API_TOKEN (input hidden): ')
  if (!answer) {
    logger.log('No token entered. Falling back to sfw-free.')
    return undefined
  }
  try {
    writeTokenToKeychain(answer)
  } catch (e) {
    logger.error(
      `Failed to persist token to keychain: ${(e as Error).message}. ` +
        'Continuing with the value for this session only — it will not ' +
        'persist across runs until the keychain tool is available.',
    )
  }
  return answer
}

async function main(): Promise<void> {
  logger.log('Socket security tools — install / verify\n')

  // Existing token state — env > .env > keychain.
  const lookup = findApiToken()
  let apiToken = lookup.token
  if (apiToken && lookup.source) {
    logger.log(`SOCKET_API_TOKEN: found via ${lookup.source}.`)
  } else {
    apiToken = await offerTokenPrompt()
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
