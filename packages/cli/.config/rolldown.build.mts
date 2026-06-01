/**
 * Rolldown build orchestrator for Socket CLI. Builds all variants (CLI bundle +
 * entry point). Replaces the esbuild orchestrator.
 *
 * Usage: node .config/rolldown.build.mts # all variants node
 * .config/rolldown.build.mts cli # CLI bundle node .config/rolldown.build.mts
 * index # entry point.
 */

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getInlinedEnvVars, runBuild } from '../scripts/rolldown-utils.mts'
import cliConfig from './rolldown.cli.mts'
import indexConfig from './rolldown.index.mts'

import type { RolldownOptions } from 'rolldown'

const logger = getDefaultLogger()

// Per-variant post-write transform options. The CLI bundle needs the
// unicode-property-escape transform (--with-intl=none compat) + env-var
// replacement; the index loader needs env-var replacement only.
const VARIANTS = {
  __proto__: null,
  cli: {
    config: cliConfig,
    options: { envVars: getInlinedEnvVars(), unicodeTransform: true },
  },
  index: {
    config: indexConfig,
    options: { envVars: getInlinedEnvVars() },
  },
} as unknown as Record<
  string,
  {
    config: RolldownOptions
    options: {
      envVars?: Record<string, string> | undefined
      unicodeTransform?: boolean | undefined
    }
  }
>

async function main(): Promise<void> {
  const variant = process.argv[2] || 'all'

  if (variant !== 'all' && !(variant in VARIANTS)) {
    logger.error(`Unknown variant: ${variant}`)
    logger.error(`Available variants: all, ${Object.keys(VARIANTS).join(', ')}`)
    process.exitCode = 1
    return
  }

  const names = variant === 'all' ? Object.keys(VARIANTS) : [variant]
  const results = await Promise.allSettled(
    names.map(name => {
      const { config, options } = VARIANTS[name]!
      return runBuild(config, name, options)
    }),
  )
  if (results.some(r => r.status === 'rejected')) {
    process.exitCode = 1
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    logger.error('Build failed:', error)
    process.exitCode = 1
  })
}
