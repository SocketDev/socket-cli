#!/usr/bin/env node
/**
 * @file Install-only entry point for Socket Firewall (sfw enterprise + free).
 *   Slim leaf of the setup-security-tools umbrella — for operators who want to
 *   install / refresh ONLY the firewall surface without re-running the
 *   AgentShield / zizmor / socket-basics tool installers. The actual installer
 *   code lives in `../setup-security-tools/lib/installers.mts`. This entry
 *   point exists so operators can scope their setup precisely: node
 *   .claude/hooks/setup-firewall/install.mts For the full setup, use `node
 *   .claude/hooks/setup-security-tools/install.mts` which sequences this leaf
 *   alongside the others. --rotate is honored here too — re-prompts for
 *   SOCKET_API_KEY and overwrites the OS keychain entry, just like the
 *   umbrella's --rotate path.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findApiToken } from '../setup-security-tools/lib/api-token.mts'
import {
  offerTokenPrompt,
  parseArgs,
  promptAndPersist,
  wireBridgeIntoShellRc,
} from '../setup-security-tools/lib/operator-prompts.mts'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  logger.log('Socket Firewall — install / verify')
  logger.log('')

  let apiToken: string | undefined
  if (args.rotate) {
    const fresh = await promptAndPersist(logger, 'rotate')
    if (fresh) {
      apiToken = fresh
    } else {
      const lookup = findApiToken()
      apiToken = lookup.token
      if (apiToken && lookup.source) {
        logger.log(`Keeping existing SOCKET_API_KEY (via ${lookup.source}).`)
      }
    }
  } else {
    const lookup = findApiToken()
    apiToken = lookup.token
    if (apiToken && lookup.source) {
      logger.log(`SOCKET_API_KEY: found via ${lookup.source}.`)
    } else {
      apiToken = await offerTokenPrompt(logger)
    }
  }

  if (apiToken) {
    wireBridgeIntoShellRc(logger, apiToken)
  }

  const { setupSfw } =
    (await import('../setup-security-tools/lib/installers.mts')) as {
      setupSfw: (apiToken: string | undefined) => Promise<boolean>
    }

  const sfwOk = await setupSfw(apiToken)
  logger.log('')
  logger.log('=== Summary ===')
  logger.log(`SFW: ${sfwOk ? 'ready' : 'FAILED'}`)
  if (!sfwOk) {
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(`setup-firewall install: ${msg}`)
  process.exitCode = 1
})
