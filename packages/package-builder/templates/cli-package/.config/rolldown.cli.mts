/**
 * Rolldown configuration for building a scaffolded Socket CLI package. Extends
 * the base CLI build config from the cli package.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getInlinedEnvVars,
  runBuild,
} from '../../cli/scripts/rolldown-utils.mts'

import baseConfig from '../../cli/.config/rolldown.cli.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

const config = {
  ...baseConfig,
  input: path.join(rootPath, '..', 'cli', 'src', 'cli-dispatch.mts'),
  output: {
    ...(baseConfig.output as object),
    file: path.join(rootPath, 'build/cli.js'),
  },
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'CLI bundle', {
    envVars: getInlinedEnvVars(),
    unicodeTransform: true,
  }).catch(() => {
    process.exitCode = 1
  })
}

export default config
