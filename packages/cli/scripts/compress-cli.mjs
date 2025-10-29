#!/usr/bin/env node
/**
 * @fileoverview Compress build/cli.js with brotli to dist/cli.js.bz.
 *
 * This script compresses the CLI bundle to reduce npm package size
 * from ~13MB to ~1.7MB (87% reduction).
 *
 * The compressed file is decompressed at runtime by dist/index.js.
 */

import crypto from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const buildPath = path.join(rootPath, 'build')
const distPath = path.join(rootPath, 'dist')

const cliPath = path.join(buildPath, 'cli.js')
const cliBzPath = path.join(distPath, 'cli.js.bz')

logger.log('')
logger.step('Compressing CLI with brotli...')

// Ensure dist/ directory exists.
mkdirSync(distPath, { recursive: true })

// Read the uncompressed CLI from build/.
const cliCode = readFileSync(cliPath)
const originalSize = cliCode.length

// Compress with brotli (max quality for best compression).
const compressed = brotliCompressSync(cliCode, {
  params: {
    [0]: 11, // BROTLI_PARAM_QUALITY: 11 (max quality).
  },
})
const compressedSize = compressed.length

// Write compressed file to dist/.
writeFileSync(cliBzPath, compressed)

const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1)
logger.success(
  `Compressed: ${(originalSize / 1024 / 1024).toFixed(2)} MB → ${(compressedSize / 1024 / 1024).toFixed(2)} MB (${compressionRatio}% reduction)`,
)

// Generate SHA256 checksum for integrity validation.
const sha256 = crypto.createHash('sha256').update(compressed).digest('hex')
const checksumPath = path.join(distPath, 'cli.js.bz.sha256')
writeFileSync(checksumPath, `${sha256}  cli.js.bz\n`)

logger.success(`SHA256: ${sha256}`)
logger.log(`Checksum written to: ${path.relative(rootPath, checksumPath)}`)

logger.log('')
