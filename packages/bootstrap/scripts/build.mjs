/**
 * Build script for Socket bootstrap package.
 *
 * Builds two versions + inflater:
 * 1. bootstrap-npm.js - Standard version for npm wrapper
 * 2. bootstrap-sea.js - Standard version for SEA binary
 * 3. index.js - Brotli inflater that loads compressed bootstraps
 *
 * Each bootstrap is also compressed to .br for reduced package size.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { build } from 'esbuild'
import colors from 'yoctocolors-cjs'

import indexConfig from '../.config/esbuild.index.config.mjs'
import npmConfig from '../.config/esbuild.npm.config.mjs'
import seaConfig from '../.config/esbuild.sea.config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

/**
 * Compress a file with Brotli and write to .br file.
 *
 * @param {string} filePath - Path to file to compress
 */
function compressFile(filePath) {
  const uncompressed = readFileSync(filePath)
  const compressed = brotliCompressSync(uncompressed, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  })

  const brPath = `${filePath}.br`
  writeFileSync(brPath, compressed)

  const reductionPercent = (
    (1 - compressed.length / uncompressed.length) *
    100
  ).toFixed(1)
  console.log(
    `  Compressed: ${(compressed.length / 1024).toFixed(2)} KB (${reductionPercent}% reduction)`,
  )
}

console.log('Building Socket bootstrap with esbuild...\\n')

try {
  // Create dist directory.
  mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })

  // Build npm version.
  console.log('→ Building npm bootstrap...')
  const npmResult = await build(npmConfig)

  // Write the transformed output (build had write: false).
  if (npmResult.outputFiles && npmResult.outputFiles.length > 0) {
    for (const output of npmResult.outputFiles) {
      writeFileSync(output.path, output.contents)
    }
  }

  console.log(`${colors.green('✓')} ${npmConfig.outfile}`)

  if (npmResult.metafile) {
    const outputSize = Object.values(npmResult.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }

  // Compress npm bootstrap.
  compressFile(npmConfig.outfile)

  // Build SEA version.
  console.log('\\n→ Building SEA bootstrap...')
  const seaResult = await build(seaConfig)

  // Write the transformed output (build had write: false).
  if (seaResult.outputFiles && seaResult.outputFiles.length > 0) {
    for (const output of seaResult.outputFiles) {
      writeFileSync(output.path, output.contents)
    }
  }

  console.log(`${colors.green('✓')} ${seaConfig.outfile}`)

  if (seaResult.metafile) {
    const outputSize = Object.values(seaResult.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }

  // Compress SEA bootstrap.
  compressFile(seaConfig.outfile)

  // Build index.js inflater.
  console.log('\\n→ Building index.js inflater...')
  const indexResult = await build(indexConfig)

  // Write the transformed output (build had write: false).
  if (indexResult.outputFiles && indexResult.outputFiles.length > 0) {
    for (const output of indexResult.outputFiles) {
      writeFileSync(output.path, output.contents)
    }
  }

  console.log(`${colors.green('✓')} ${indexConfig.outfile}`)

  if (indexResult.metafile) {
    const outputSize = Object.values(indexResult.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }

  console.log(`\\n${colors.green('✓')} Build completed successfully`)
} catch (error) {
  console.error('\\n✗ Build failed:', error)
  process.exit(1)
}
