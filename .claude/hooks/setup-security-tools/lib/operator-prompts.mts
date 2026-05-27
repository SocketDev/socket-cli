/**
 * @file Operator-prompt helpers shared between the setup-security-tools
 *   umbrella's install.mts and the scoped leaves (setup-firewall, etc.). Each
 *   helper here is library-shaped: no top-level side effects, no process.exit,
 *   no implicit logger ownership. Callers pass their own logger so each
 *   entrypoint can label its prompts/outputs differently. What's intentionally
 *   NOT here:
 *
 *   - `findBrokenShims()` — only used by the umbrella to print a pre-install
 *     warning. Stays in install.mts.
 *   - `main()` — orchestration, not a helper.
 */

import process from 'node:process'
import readline from 'node:readline'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import type { Logger } from '@socketsecurity/lib-stable/logger/logger'

import { installShellRcBridge } from './shell-rc-bridge.mts'
import type { BridgeWriteResult } from './shell-rc-bridge.mts'
import { keychainAvailable, writeTokenToKeychain } from './token-storage.mts'

export interface CliArgs {
  readonly rotate: boolean
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let rotate = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--rotate' || arg === '--update-token') {
      rotate = true
    }
  }
  return { rotate }
}

/**
 * Read a secret from the TTY without echoing it. Wraps node:readline with
 * custom output muting — typed characters never appear on screen and never end
 * up in shell history.
 *
 * Caller must verify `process.stdin.isTTY` before invoking.
 */
export async function promptSecret(prompt: string): Promise<string> {
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
 * Shared prompt-and-persist body used by both the "no token found" and the
 * explicit `--rotate` paths. The `reason` strings differ but the gating + the
 * prompt + the keychain write are identical.
 */
export async function promptAndPersist(
  logger: Logger,
  reason: 'missing' | 'rotate',
): Promise<string | undefined> {
  if (getCI()) {
    logger.log(
      'CI environment detected — skipping the SOCKET_API_KEY prompt. ' +
        'Falling back to sfw-free.',
    )
    return undefined
  }
  if (!process.stdin.isTTY) {
    logger.log(
      'No TTY — skipping the SOCKET_API_KEY prompt. ' +
        'Falling back to sfw-free. Set SOCKET_API_KEY in env or run ' +
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
      `Rotating SOCKET_API_KEY — the keychain entry will be overwritten ` +
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
    'Get a token at https://socket.dev/dashboard or press Enter to skip' +
      (reason === 'rotate'
        ? ' (the existing keychain entry stays in place).'
        : ' and use sfw-free.'),
  )
  logger.log('')
  const answer = await promptSecret('SOCKET_API_KEY (input hidden): ')
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
      logger.success(`SOCKET_API_KEY rotated and persisted via ${kc.toolName}.`)
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
 * Thin alias for the "no token found" prompt path. Same shape as
 * `promptAndPersist(logger, 'missing')` but reads better at call sites that are
 * only ever in the missing-token branch.
 */
export async function offerTokenPrompt(
  logger: Logger,
): Promise<string | undefined> {
  return promptAndPersist(logger, 'missing')
}

/**
 * Print a one-paragraph summary of what the shell-rc bridge did (or didn't do),
 * with a copy-pasteable next step.
 */
export function reportBridgeOutcome(
  logger: Logger,
  bridge: BridgeWriteResult | undefined,
): void {
  if (!bridge) {
    // Non-macOS or no rc detectable — fall through to a manual line
    // the user can paste. We hand the user a literal-export template
    // (not a keychain-read) because re-reading the keychain on every
    // shell triggers an auth prompt on macOS.
    logger.log('')
    logger.log(
      'Add this to your shell rc / .zshenv so SOCKET_API_KEY is exported ' +
        'each session (every Socket tool reads it without a fallback chain):',
    )
    logger.log("  export SOCKET_API_KEY='<your-token>'")
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
        '` (or open a new shell) so SOCKET_API_KEY gets exported.',
    )
  } else {
    logger.success(
      `Wrote the shell-rc env block to ${bridge.rcPath}. ` +
        'Run `source ' +
        bridge.rcPath +
        '` (or open a new shell) so SOCKET_API_KEY gets exported.',
    )
  }
}

/**
 * Write (or refresh) the keychain → shell-env bridge block in the user's shell
 * rc. Idempotent: re-running on an already-wired rc is a no-op.
 */
export function wireBridgeIntoShellRc(logger: Logger, token: string): void {
  try {
    const bridge = installShellRcBridge(token)
    reportBridgeOutcome(logger, bridge)
  } catch (e) {
    logger.warn(
      `Failed to write the shell-rc env block: ${(e as Error).message}. ` +
        'You will need to export SOCKET_API_KEY manually for Socket tools to pick it up.',
    )
  }
}
