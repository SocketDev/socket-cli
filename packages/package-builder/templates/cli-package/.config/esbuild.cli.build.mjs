/**
 * esbuild configuration for building Socket CLI.
 * Extends the base CLI build configuration.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import baseConfig from '../../cli/.config/esbuild.cli.build.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Create standard CLI configuration.
const config = {
  ...baseConfig,
  // Use the standard entry point.
  entryPoints: [
    path.join(rootPath, '..', 'cli', 'src', 'cli-dispatch.mts'),
  ],
  // Output to build directory.
  outfile: path.join(rootPath, 'build/cli.js'),
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
      console.error('Build failed:', error)
      process.exitCode = 1
    })
}

export default config
