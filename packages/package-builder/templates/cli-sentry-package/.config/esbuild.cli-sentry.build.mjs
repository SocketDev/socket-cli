/**
 * esbuild configuration for building Socket CLI with Sentry integration.
 * Extends the base CLI build configuration with Sentry-specific settings.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import baseConfig from '../../cli/.config/esbuild.cli.build.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Create Sentry-enabled configuration.
const config = {
  ...baseConfig,
  // Use the Sentry-enabled entry point.
  entryPoints: [
    path.join(rootPath, '..', 'cli', 'src', 'cli-dispatch-with-sentry.mts'),
  ],
  // Output to build directory.
  outfile: path.join(rootPath, 'build/cli.js'),
  // Override define to enable Sentry build flag.
  define: {
    ...baseConfig.define,
    'process.env.INLINED_SOCKET_CLI_SENTRY_BUILD': JSON.stringify('1'),
    'process.env["INLINED_SOCKET_CLI_SENTRY_BUILD"]': JSON.stringify('1'),
  },
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config)
    .then(result => {
      // Write the transformed output (build had write: false).
      if (result.outputFiles && result.outputFiles.length > 0) {
        mkdirSync(path.dirname(config.outfile), { recursive: true })
        for (const output of result.outputFiles) {
          writeFileSync(output.path, output.contents)
        }
      }
    })
    .catch(error => {
      logger.error('Build failed:', error)
      process.exitCode = 1
    })
}

export default config
