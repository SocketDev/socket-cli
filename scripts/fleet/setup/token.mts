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

import { findApiToken } from '../../.claude/hooks/fleet/setup-security-tools/lib/api-token.mts'
import {
  offerTokenPrompt,
  parseArgs,
  promptAndPersist,
  wireBridgeIntoShellRc,
} from '../../.claude/hooks/fleet/setup-security-tools/lib/operator-prompts.mts'

async function main(): Promise<void> {
  const logger = getDefaultLogger()
  const args = parseArgs(process.argv.slice(2))
  const rotate = args.rotate ?? args['update-token'] ?? false

  let apiToken: string | undefined

  if (rotate) {
    apiToken = await promptAndPersist(logger, 'rotate')
  } else {
    const lookup = await findApiToken()
    if (lookup) {
      logger.log(
        `SOCKET_API_TOKEN: found via ${lookup.source} — no prompt needed.`,
      )
      logger.log('Pass --rotate to overwrite.')
      apiToken = lookup.value
    } else {
      apiToken = await offerTokenPrompt(logger)
    }
  }

  if (apiToken) {
    wireBridgeIntoShellRc(logger, apiToken)
    logger.log('')
    logger.log('Token setup complete.')
  } else {
    logger.log('No token set — continuing without one.')
  }
}

void main()
