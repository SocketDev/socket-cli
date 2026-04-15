/**
 * esbuild build orchestrator for Socket CLI.
 * Builds all variants (CLI bundle + entry point) in parallel.
 *
 * Usage:
 *   node .config/esbuild.build.mts          # Build all variants
 *   node .config/esbuild.build.mts cli      # Build CLI bundle
 *   node .config/esbuild.build.mts index    # Build entry point
 */

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { runBuild } from '../scripts/esbuild-utils.mts'
import cliConfig from './esbuild.cli.mts'
import indexConfig from './esbuild.index.mts'

const logger = getDefaultLogger()

export const CONFIGS = {
  __proto__: null,
  cli: cliConfig,
  index: indexConfig,
}

async function main() {
  const variant = process.argv[2] || 'all'

  if (variant !== 'all' && !(variant in CONFIGS)) {
    logger.error(`Unknown variant: ${variant}`)
    logger.error(`Available variants: all, ${Object.keys(CONFIGS).join(', ')}`)
    process.exitCode = 1
    return
  }

  const targets =
    variant === 'all'
      ? Object.entries(CONFIGS)
      : [[variant, CONFIGS[variant]]]

  const results = await Promise.allSettled(
    targets.map(({ 0: name, 1: config }) => runBuild(config, name)),
  )
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    process.exitCode = 1
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    logger.error('Build failed:', error)
    process.exitCode = 1
  })
}

export default CONFIGS
