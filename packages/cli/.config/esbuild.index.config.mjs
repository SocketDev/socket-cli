/**
 * esbuild configuration for Socket CLI index loader.
 * Builds the index loader that executes the CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { createIndexConfig } from '../scripts/esbuild-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = createIndexConfig({
  entryPoint: path.join(rootPath, 'src', 'index.mts'),
  outfile: path.join(rootPath, 'dist', 'index.js'),
})

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config).catch(error => {
    console.error('Index loader build failed:', error)
    process.exitCode = 1
  })
}

export default config
