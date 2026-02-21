/**
 * esbuild build script for Socket CLI.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { brotliCompressSync } from 'node:zlib'

import { build } from 'esbuild'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import config from './esbuild.cli.config.mjs'

const logger = getDefaultLogger()
logger.log('Building Socket CLI with esbuild...\n')

try {
  const result = await build(config)

  logger.log('✓ Build completed successfully')
  logger.log(`✓ Output: ${config.outfile}`)

  if (result.metafile) {
    const outputSize = Object.values(result.metafile.outputs)[0]?.bytes
    if (outputSize) {
      logger.log(`✓ Bundle size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`)
    }
  }

  // Compress with brotli.
  logger.log('\n🗜️  Compressing with brotli...')
  const jsCode = readFileSync(config.outfile)
  const compressed = brotliCompressSync(jsCode, {
    params: {
      [require('node:zlib').constants.BROTLI_PARAM_QUALITY]: 11,

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

  logger.log(`✓ Compressed: ${bzPath}`)
  logger.log(`✓ Original size: ${originalSize.toFixed(2)} MB`)
  logger.log(`✓ Compressed size: ${compressedSize.toFixed(2)} MB`)
  logger.log(`✓ Compression ratio: ${compressionRatio}%`)
} catch (error) {
  logger.error('Build failed:', error)
  process.exitCode = 1
}
