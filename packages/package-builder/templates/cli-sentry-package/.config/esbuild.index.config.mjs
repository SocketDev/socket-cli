/**
 * esbuild configuration for Socket CLI with Sentry index loader.
 * Builds the index loader that executes the CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { createIndexConfig } from '../../cli/scripts/esbuild-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const cliPath = path.resolve(__dirname, '../../cli')

const config = createIndexConfig({
  entryPoint: path.join(cliPath, 'src', 'index.mts'),
  outfile: path.join(rootPath, 'dist', 'index.js'),
  minify: true,
})

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config).catch(error => {
    logger.error('Index loader build failed:', error)
    process.exitCode = 1
  })
}

export default config
