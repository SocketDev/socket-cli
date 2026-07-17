#!/usr/bin/env node
/**
 * @file Prompt for the Socket API token and persist it to the OS keychain.
 *   Writes SOCKET_API_TOKEN and SOCKET_API_KEY under service "socket-cli":
 *   macOS — Keychain Access (security add-generic-password) Linux — libsecret
 *   (secret-tool store) Windows — CredentialManager PowerShell module → DPAPI
 *   file fallback Also wires a shell rc bridge so every new terminal has
 *   SOCKET_API_KEY exported without a keychain read. Usage: node
 *   scripts/fleet/setup/token.mts node scripts/fleet/setup/token.mts --rotate.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findApiToken } from '../../../.claude/hooks/fleet/setup-security-tools/lib/api-token.mts'
import {
  offerTokenPrompt,
  parseArgs,
  promptAndPersist,
  wireBridgeIntoShellRc,
} from '../../../.claude/hooks/fleet/setup-security-tools/lib/operator-prompts.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

// The two lines logged when an existing token is found via `source` (env var
// or keychain) and the prompt is skipped.
export function formatFoundTokenLines(source: string): string[] {
  return [
    `SOCKET_API_TOKEN: found via ${source} — no prompt needed.`,
    'Pass --rotate to overwrite.',
  ]
}

// The closing line(s) once the token flow settles: a persisted token gets a
// blank-line separator + confirmation, no token gets a single skip note.
export function formatCompletionLines(hasToken: boolean): string[] {
  return hasToken
    ? ['', 'Token setup complete.']
    : ['No token set — continuing without one.']
}

export async function main(): Promise<void> {
  const logger = getDefaultLogger()
  const args = parseArgs(process.argv.slice(2))
  const rotate = args.rotate

  let apiToken: string | undefined

  if (rotate) {
    apiToken = await promptAndPersist(logger, 'rotate')
  } else {
    const lookup = await findApiToken()
    // findApiToken always returns an object; a hit sets token + source
    // together. Narrowing on the fields (not the object) also revives the
    // prompt fallback, which an always-truthy `if (lookup)` had made dead.
    if (lookup.token && lookup.source) {
      for (const line of formatFoundTokenLines(lookup.source)) {
        logger.log(line)
      }
      apiToken = lookup.token
    } else {
      apiToken = await offerTokenPrompt(logger)
    }
  }

  if (apiToken) {
    wireBridgeIntoShellRc(logger, apiToken)
  }
  for (const line of formatCompletionLines(Boolean(apiToken))) {
    logger.log(line)
  }
}

if (isMainModule(import.meta.url)) {
  void main()
}
