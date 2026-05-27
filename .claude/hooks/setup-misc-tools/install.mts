#!/usr/bin/env node
/**
 * @file Install-only entry point for one-off tools: cdxgen (SBOM), synp
 *   (lockfile interop), and janus. Slim leaf of the `setup-security-tools`
 *   umbrella. Run via: node .claude/hooks/setup-misc-tools/install.mts For the
 *   full setup (firewall + scanners + socket-basics + misc), use `node
 *   .claude/hooks/setup-security-tools/install.mts`.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  logger.log('misc tools — install / verify')
  logger.log('')

  const { setupCdxgen, setupSynp, setupJanus } =
    (await import('../setup-security-tools/lib/installers.mts')) as {
      setupCdxgen: () => Promise<boolean>
      setupSynp: () => Promise<boolean>
      setupJanus: () => Promise<boolean>
    }

  const [cdxgenOk, synpOk, janusOk] = await Promise.all([
    setupCdxgen(),
    setupSynp(),
    setupJanus(),
  ])
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`cdxgen: ${cdxgenOk ? 'ready' : 'FAILED'}`)
  logger.log(`janus:  ${janusOk ? 'ready' : 'FAILED'}`)
  logger.log(`synp:   ${synpOk ? 'ready' : 'FAILED'}`)

  if (!(cdxgenOk && synpOk && janusOk)) {
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  logger.error(`setup-misc-tools install: ${msg}`)
  process.exitCode = 1
})
