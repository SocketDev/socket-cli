/**
 * esbuild build script for Socket CLI.
 */

import { build } from 'esbuild'

import config from './esbuild.cli.config.mjs'

console.log('Building Socket CLI with esbuild...\n')

try {
  const result = await build(config)

  console.log('✓ Build completed successfully')
  console.log(`✓ Output: ${config.outfile}`)

  if (result.metafile) {
    const outputSize = Object.values(result.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`✓ Bundle size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`)
    }
  }
} catch (error) {
  console.error('Build failed:', error)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}
