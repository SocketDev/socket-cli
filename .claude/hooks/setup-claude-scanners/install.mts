#!/usr/bin/env node
/**
 * @file Install-only entry point for AgentShield + zizmor — the two
 *   claude-config / GitHub-Actions scanners. Slim leaf of the
 *   `setup-security-tools` umbrella. Run via: node
 *   .claude/hooks/setup-claude-scanners/install.mts For the full setup
 *   (firewall + scanners + socket-basics + misc), use `node
 *   .claude/hooks/setup-security-tools/install.mts`.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  logger.log('Claude scanners — install / verify')
  logger.log('')

  const { setupAgentShield, setupZizmor } =
    (await import('../setup-security-tools/lib/installers.mts')) as {
      setupAgentShield: () => Promise<boolean>
      setupZizmor: () => Promise<boolean>
    }

  const agentshieldOk = await setupAgentShield()
  logger.log('')
  const zizmorOk = await setupZizmor()
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`AgentShield: ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`Zizmor:      ${zizmorOk ? 'ready' : 'FAILED'}`)

  if (!(agentshieldOk && zizmorOk)) {
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(`setup-claude-scanners install: ${msg}`)
  process.exitCode = 1
})
