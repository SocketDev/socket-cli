/**
 * Build script for Socket npm wrapper bootstrap.
 */

import { build } from 'esbuild'

import config from './esbuild.bootstrap.config.mjs'

console.log('Building Socket npm wrapper bootstrap with esbuild...\n')

try {
  const result = await build(config)

  console.log('✓ Build completed successfully')
  console.log(`✓ Output: ${config.outfile}`)

  if (result.metafile) {
    const outputSize = Object.values(result.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`✓ Bundle size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }
} catch (error) {
  console.error('Build failed:', error)
  process.exit(1)
}
