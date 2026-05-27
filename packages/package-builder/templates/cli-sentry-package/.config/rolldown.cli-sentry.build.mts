/**
 * Rolldown configuration for building a scaffolded Socket CLI with Sentry
 * integration. Extends the base CLI build config with Sentry-specific settings.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getInlinedEnvVars,
  runBuild,
} from '../../cli/scripts/rolldown-utils.mts'

import baseConfig from '../../cli/.config/rolldown.cli.mts'

import type { RolldownOptions } from 'rolldown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const cliPath = path.join(__dirname, '..', '..', 'cli')

const config: RolldownOptions = {
  ...baseConfig,
  input: path.join(cliPath, 'src/cli-dispatch-with-sentry.mts'),
  external: '@sentry/node',
  transform: {
    ...baseConfig.transform,
    define: {
      ...baseConfig.transform?.define,
      'process.env.INLINED_SENTRY_BUILD': JSON.stringify('1'),
      'process.env["INLINED_SENTRY_BUILD"]': JSON.stringify('1'),
    },
  },
  output: {
    ...(baseConfig.output as object),
    file: path.join(rootPath, 'build/cli.js'),
  },
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'CLI bundle (Sentry)', {
    envVars: getInlinedEnvVars(),
    unicodeTransform: true,
  }).catch(() => {
    process.exitCode = 1
  })
}

export default config
