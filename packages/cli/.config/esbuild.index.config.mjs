/**
 * esbuild configuration for Socket CLI index loader.
 * Builds the index loader that executes the CLI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createBuildRunner,
  createIndexConfig,
} from '../scripts/esbuild-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')

const config = createIndexConfig({
  entryPoint: path.join(rootPath, 'src', 'index.mts'),
  outfile: path.join(rootPath, 'dist', 'index.js'),
})

export default createBuildRunner(config, 'Index loader')
