/**
 * @fileoverview esbuild configuration for Socket CLI with Sentry telemetry.
 * Builds a Sentry-enabled version of the CLI with error reporting.
 */

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Import base esbuild config from main CLI.
import baseConfig from '../../cli/.config/esbuild.cli.build.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const cliPath = path.join(__dirname, '..', '..', 'cli')

// Override entry point to use CLI dispatch with Sentry telemetry.
const config = {
  ...baseConfig,
  entryPoints: [path.join(cliPath, 'src/cli-dispatch-with-sentry.mts')],
  outfile: path.join(rootPath, 'dist/cli.js'),

  // Override define to enable Sentry build.
  define: {
    ...baseConfig.define,
    'process.env.INLINED_SOCKET_CLI_SENTRY_BUILD': JSON.stringify('1'),
  },

  // Include @sentry/node in the bundle (don't externalize it).
  external: baseConfig.external?.filter(
    ext => !ext.startsWith('@sentry') && ext !== '@sentry/node',
  ),
}

// Run build if invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  build(config).catch(error => {
    console.error('Build failed:', error)
    process.exitCode = 1
  })
}

export default config
