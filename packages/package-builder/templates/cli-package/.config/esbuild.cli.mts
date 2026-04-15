/**
 * esbuild configuration for building Socket CLI.
 * Extends the base CLI build configuration.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runBuild } from '../../cli/scripts/esbuild-utils.mts'

import baseConfig from '../../cli/.config/esbuild.cli.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

const config = {
  ...baseConfig,
  entryPoints: [path.join(rootPath, '..', 'cli', 'src', 'cli-dispatch.mts')],
  outfile: path.join(rootPath, 'build/cli.js'),
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runBuild(config, 'CLI bundle').catch(() => { process.exitCode = 1 })
}

export default config
