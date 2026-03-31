/**
 * esbuild configuration for building Socket CLI with Sentry integration.
 * Extends the base CLI build configuration with Sentry-specific settings.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runBuild } from '../../cli/scripts/esbuild-utils.mjs'

import baseConfig from '../../cli/.config/esbuild.cli.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const cliPath = path.join(__dirname, '..', '..', 'cli')

const config = {
  ...baseConfig,
  entryPoints: [path.join(cliPath, 'src/cli-dispatch-with-sentry.mts')],
  outfile: path.join(rootPath, 'build/cli.js'),
  define: {
    ...baseConfig.define,
    'process.env.INLINED_SENTRY_BUILD': JSON.stringify('1'),
    'process.env["INLINED_SENTRY_BUILD"]': JSON.stringify('1'),
  },
  external: [...(baseConfig.external || []), '@sentry/node'],
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'CLI bundle (Sentry)')
}

export default config
