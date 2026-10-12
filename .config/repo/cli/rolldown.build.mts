/**
 * Build the payload and entry point for the Socket CLI package.
 */

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  getInlinedEnvVars,
  parseCliBuildMode,
  runBuild,
} from '../../../scripts/repo/build/rolldown-utils.mts'
import { createCliBuildConfig } from './rolldown.cli.mts'
import { indexConfig } from './rolldown.index.mts'

const logger = getDefaultLogger()

export async function runCliRolldownBuild(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const mode = parseCliBuildMode(args)
  const cliConfig = createCliBuildConfig({ mode })
  const envVars = getInlinedEnvVars()
  const results = await Promise.allSettled([
    runBuild(cliConfig, {
      description: 'CLI payload',
      envVars,
      unicodeTransform: true,
    }),
    runBuild(indexConfig, { description: 'CLI entry point', envVars }),
  ])
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCliRolldownBuild().catch(error => {
    logger.error('Build failed:', error)
    process.exitCode = 1
  })
}
