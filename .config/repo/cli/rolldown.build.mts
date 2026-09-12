/**
 * Build the payload and entry point for the Socket CLI package.
 */

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  getInlinedEnvVars,
  runBuild,
} from '../../../scripts/repo/cli-build/rolldown-utils.mts'
import { cliConfig } from './rolldown.cli.mts'
import { indexConfig } from './rolldown.index.mts'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  const envVars = getInlinedEnvVars()
  const results = await Promise.allSettled([
    runBuild(cliConfig, {
      description: 'CLI payload',
      envVars,
      unicodeTransform: true,
    }),
    runBuild(indexConfig, { description: 'CLI entry point', envVars }),
  ])
  if (results.some(result => result.status === 'rejected')) {
    process.exitCode = 1
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    logger.error('Build failed:', error)
    process.exitCode = 1
  })
}
