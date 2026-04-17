/**
 * esbuild configuration for Socket CLI with Sentry index loader.
 * Builds the index loader that executes the CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createIndexConfig,
  runBuild,
} from '../../cli/scripts/esbuild-utils.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const cliPath = path.resolve(__dirname, '../../cli')

const config = createIndexConfig({
  entryPoint: path.join(cliPath, 'src', 'index.mts'),
  outfile: path.join(rootPath, 'dist', 'index.js'),
  minify: false,
})

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'Entry point').catch(() => { process.exitCode = 1 })
}

export default config
