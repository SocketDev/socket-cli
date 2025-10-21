/**
 * Test script to run Brotli compression on Node.js lib/ files
 * This tests the compression function without requiring full build integration
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.join(__dirname, '..')
const NODE_DIR = path.join(ROOT_DIR, '.node-source')

async function testBrotliCompression() {
  const { build } = await import('esbuild')

  console.log('🧪 Testing Brotli Compression on Node.js lib/ files\n')

  let totalOriginalSize = 0
  let totalMinifiedSize = 0
  let totalCompressedSize = 0
  let filesCompressed = 0

  async function* walkDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        yield* walkDir(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        yield fullPath
      }
    }
  }

  const libDir = path.join(NODE_DIR, 'lib')

  for await (const jsFile of walkDir(libDir)) {
    const relativePath = path.relative(libDir, jsFile)
    try {
      const original = await readFile(jsFile, 'utf8')
      const originalSize = Buffer.byteLength(original, 'utf8')

      // Minify
      const minifyResult = await build({
        stdin: {
          contents: original,
          loader: 'js',
          sourcefile: jsFile,
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

      // Compress
      const compressed = brotliCompressSync(minifiedCode, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]:
            zlibConstants.BROTLI_MAX_QUALITY,
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        },
      })

      const compressedSize = compressed.length
      const totalRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1)

      if (compressedSize < originalSize * 0.9) {
        totalOriginalSize += originalSize
        totalMinifiedSize += minifiedSize
        totalCompressedSize += compressedSize
        filesCompressed++

        console.log(
          `   ✓ ${relativePath.padEnd(50)} ` +
            `${(originalSize / 1024).toFixed(1)}KB → ` +
            `${(minifiedSize / 1024).toFixed(1)}KB → ` +
            `${(compressedSize / 1024).toFixed(1)}KB ` +
            `(-${totalRatio}%)`,
        )
      }
    } catch (e) {
      console.warn(`   ⚠️  Skipped ${relativePath}: ${e.message}`)
    }
  }

  console.log()
  console.log(`✅ Processed ${filesCompressed} files`)
  console.log(
    `   Original:     ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`,
  )
  console.log(
    `   Minified:     ${(totalMinifiedSize / 1024 / 1024).toFixed(2)} MB (-${((1 - totalMinifiedSize / totalOriginalSize) * 100).toFixed(1)}%)`,
  )
  console.log(
    `   Compressed:   ${(totalCompressedSize / 1024 / 1024).toFixed(2)} MB (-${((1 - totalCompressedSize / totalOriginalSize) * 100).toFixed(1)}%)`,
  )
  console.log()
  console.log(
    `💾 Total savings: ${((totalOriginalSize - totalCompressedSize) / 1024 / 1024).toFixed(2)} MB`,
  )
}

testBrotliCompression().catch(console.error)
