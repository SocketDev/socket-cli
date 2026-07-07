#!/usr/bin/env node
/**
 * @file Install-only entry point for the socket-basics workflow stack:
 *   TruffleHog (secrets scanner), Trivy (vuln/SBOM scanner), OpenGrep (SAST),
 *   and uv (Python package manager bootstrap). Slim leaf of the
 *   `setup-security-tools` umbrella. Run via: node
 *   .claude/hooks/fleet/setup-basics-tools/install.mts For the full setup
 *   (firewall + scanners + socket-basics + misc), use `node
 *   .claude/hooks/fleet/setup-security-tools/install.mts`.
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  logger.log('socket-basics tools — install / verify')
  logger.log('')

  const { setupTrufflehog, setupTrivy, setupOpengrep, setupUv } =
    (await import('../setup-security-tools/lib/installers.mts')) as {
      setupTrufflehog: () => Promise<boolean>
      setupTrivy: () => Promise<boolean>
      setupOpengrep: () => Promise<boolean>
      setupUv: () => Promise<boolean>
    }

  const [trufflehogOk, trivyOk, opengrepOk, uvOk] = await Promise.all([
    setupTrufflehog(),
    setupTrivy(),
    setupOpengrep(),
    setupUv(),
  ])
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`OpenGrep:    ${opengrepOk ? 'ready' : 'FAILED'}`)
  logger.log(`Trivy:       ${trivyOk ? 'ready' : 'FAILED'}`)
  logger.log(`TruffleHog:  ${trufflehogOk ? 'ready' : 'FAILED'}`)
  logger.log(`uv:          ${uvOk ? 'ready' : 'FAILED'}`)

  if (!(opengrepOk && trivyOk && trufflehogOk && uvOk)) {
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  const msg = errorMessage(e)
  logger.error(`setup-basics-tools install: ${msg}`)
  process.exitCode = 1
})
