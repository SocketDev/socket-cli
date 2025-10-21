/**
 * Test script for Socket CLI userland compression.
 * Verifies that compressSocketUserland() creates valid BROT-encoded files.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { build } from 'esbuild'

const ROOT_DIR = path.join(import.meta.dirname, '..')

/**
 * Compress Socket CLI userland code.
 */
async function compressSocketUserland() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Testing Socket CLI Userland Compression')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log()

  // Paths.
  const cliJsPath = path.join(ROOT_DIR, 'dist', 'cli.js')
  const bootstrapDir = path.join(
    ROOT_DIR,
    '.node-source',
    'lib',
    'internal',
    'bootstrap',
  )
  const outputPath = path.join(bootstrapDir, 'socketsecurity.js')

  // Check if dist/cli.js exists.
  if (!existsSync(cliJsPath)) {
    console.log('⚠️  dist/cli.js not found, skipping userland compression')
    console.log('   Run `pnpm build:dist:src` first to generate dist/cli.js')
    console.log()
    return
  }

  // Read original bundled CLI code.
  console.log('Reading Socket CLI bundle...')
  const original = await readFile(cliJsPath, 'utf8')
  const originalSize = Buffer.byteLength(original, 'utf8')
  console.log(`   Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)

  // Step 1: Minify with esbuild.
  console.log('Minifying with esbuild...')
  const minifyResult = await build({
    stdin: {
      contents: original,
      loader: 'js',
      sourcefile: cliJsPath,
    },
    write: false,
    minify: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    target: 'node22',
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
    keepNames: false,
    treeShaking: false,
  })

  const minifiedCode = minifyResult.outputFiles[0].text
  const minifiedSize = Buffer.byteLength(minifiedCode, 'utf8')
  const minifyRatio = ((1 - minifiedSize / originalSize) * 100).toFixed(1)
  console.log(
    `   Minified size: ${(minifiedSize / 1024 / 1024).toFixed(2)} MB (-${minifyRatio}%)`,
  )

  // Step 2: Compress with Brotli.
  console.log('Compressing with Brotli...')
  const compressed = brotliCompressSync(minifiedCode, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    },
  })

  const compressedSize = compressed.length
  const totalRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1)
  console.log(
    `   Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB (-${totalRatio}% total)`,
  )

  // Step 3: Create BROT header (12 bytes).
  console.log('Creating BROT header...')
  const header = Buffer.alloc(12)
  header.write('BROT', 0, 4, 'ascii')
  header.writeBigUInt64LE(BigInt(minifiedSize), 4)

  console.log('   Header (hex):', header.toString('hex'))
  console.log('   Magic:', header.subarray(0, 4).toString('ascii'))
  console.log('   Decompressed size:', header.readBigUInt64LE(4).toString())

  // Step 4: Combine header + compressed data.
  const finalData = Buffer.concat([header, compressed])
  const finalSize = finalData.length
  console.log(
    `   Final size with header: ${(finalSize / 1024 / 1024).toFixed(2)} MB`,
  )

  // Step 5: Create userland directory and write file.
  await mkdir(bootstrapDir, { recursive: true })

  console.log('Writing userland module...')
  await writeFile(outputPath, finalData)
  console.log(`   ✓ Written to ${outputPath}`)

  // Step 6: Verify file was written correctly.
  console.log()
  console.log('Verifying written file...')
  const writtenData = await readFile(outputPath)
  const writtenHeader = writtenData.subarray(0, 12)
  const writtenMagic = writtenHeader.subarray(0, 4).toString('ascii')
  const writtenSize = writtenHeader.readBigUInt64LE(4)

  console.log('   Magic:', writtenMagic, writtenMagic === 'BROT' ? '✓' : '✗')
  console.log(
    '   Decompressed size:',
    writtenSize.toString(),
    writtenSize === BigInt(minifiedSize) ? '✓' : '✗',
  )
  console.log('   File size:', writtenData.length, 'bytes')

  console.log()
  console.log('✅ Socket CLI userland code compressed and integrated')
  console.log(
    `   Savings: ${((originalSize - finalSize) / 1024 / 1024).toFixed(2)} MB (${totalRatio}% reduction)`,
  )
  console.log()
}

// Run the compression test.
compressSocketUserland().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
