/**
 * esbuild configuration for Socket CLI index loader.
 * Builds the index loader that executes the CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createIndexConfig,
  runBuild,
} from '../scripts/esbuild-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = createIndexConfig({
  entryPoint: path.join(rootPath, 'src', 'index.mts'),
  outfile: path.join(rootPath, 'dist', 'index.js'),
})

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'Entry point').catch(() => { process.exitCode = 1 })
}

export default config
