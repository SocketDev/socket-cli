/**
 * esbuild build script for Socket CLI.
 */

import { brotliCompressSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
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

  // Compress with brotli.
  console.log('\n🗜️  Compressing with brotli...')
  const jsCode = readFileSync(config.outfile)
  const compressed = brotliCompressSync(jsCode, {
    params: {
      // eslint-disable-next-line n/prefer-global/buffer
      [require('node:zlib').constants.BROTLI_PARAM_QUALITY]: 11,
      // eslint-disable-next-line n/prefer-global/buffer
      [require('node:zlib').constants.BROTLI_PARAM_SIZE_HINT]: jsCode.length,
    },
  })

  const bzPath = `${config.outfile}.bz`
  writeFileSync(bzPath, compressed)

  const originalSize = jsCode.length / 1024 / 1024
  const compressedSize = compressed.length / 1024 / 1024
  const compressionRatio = ((compressed.length / jsCode.length) * 100).toFixed(
    1,
  )

  console.log(`✓ Compressed: ${bzPath}`)
  console.log(`✓ Original size: ${originalSize.toFixed(2)} MB`)
  console.log(`✓ Compressed size: ${compressedSize.toFixed(2)} MB`)
  console.log(`✓ Compression ratio: ${compressionRatio}%`)
} catch (error) {
  console.error('Build failed:', error)
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}
