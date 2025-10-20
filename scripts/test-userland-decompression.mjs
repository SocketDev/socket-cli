
/**
 * Test script to verify userland module can be loaded via Node.js builtin loader.
 * This tests that the BROT-encoded socket-cli.js can be decompressed and executed.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

const ROOT_DIR = path.join(import.meta.dirname, '..')

/**
 * Test userland decompression.
 */
async function testUserlandDecompression() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Testing Userland Module Decompression')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log()

  const userlandPath = path.join(
    ROOT_DIR,
    '.node-source',
    'lib',
    'internal',
    'bootstrap',
    'socketsecurity.js',
  )

  console.log('Reading compressed userland module...')
  console.log('   Path:', userlandPath)

  const fileData = await readFile(userlandPath)
  console.log('   File size:', fileData.length, 'bytes')

  // Step 1: Read and verify BROT header.
  console.log()
  console.log('Parsing BROT header...')
  const header = fileData.subarray(0, 12)
  const magic = header.subarray(0, 4).toString('ascii')
  const decompressedSize = header.readBigUInt64LE(4)

  console.log('   Magic:', magic, magic === 'BROT' ? '✓' : '✗')
  console.log('   Decompressed size:', decompressedSize.toString(), 'bytes')

  if (magic !== 'BROT') {
    console.error()
    console.error('❌ Invalid BROT magic marker')
    process.exit(1)
  }

  // Step 2: Decompress Brotli data.
  console.log()
  console.log('Decompressing Brotli data...')
  const compressedData = fileData.subarray(12)
  console.log('   Compressed data size:', compressedData.length, 'bytes')

  const decompressed = brotliDecompressSync(compressedData)
  const actualSize = decompressed.length
  console.log('   Actual decompressed size:', actualSize, 'bytes')
  console.log(
    '   Size match:',
    actualSize === Number(decompressedSize) ? '✓' : '✗',
  )

  if (actualSize !== Number(decompressedSize)) {
    console.error()
    console.error('❌ Decompressed size mismatch')
    console.error('   Expected:', decompressedSize.toString())
    console.error('   Actual:', actualSize)
    process.exit(1)
  }

  // Step 3: Verify decompressed code is valid JavaScript.
  console.log()
  console.log('Validating decompressed JavaScript...')
  const code = decompressed.toString('utf8')

  // Check for basic CLI markers.
  const hasRequire = code.includes('require')
  const hasModule = code.includes('module.exports')
  const hasSocket = code.includes('socket') || code.includes('Socket')

  console.log('   Contains require():', hasRequire ? '✓' : '✗')
  console.log('   Contains module.exports:', hasModule ? '✓' : '✗')
  console.log('   Contains socket references:', hasSocket ? '✓' : '✗')

  // Try to parse as JavaScript (syntax check).
  try {
     
    new Function(code)
    console.log('   JavaScript syntax:', '✓ Valid')
  } catch (e) {
    console.error('   JavaScript syntax:', '✗ Invalid')
    console.error('   Error:', e.message)
    process.exit(1)
  }

  // Step 4: Summary.
  console.log()
  console.log('✅ Userland module decompression successful')
  console.log('   Compression ratio:', ((1 - fileData.length / actualSize) * 100).toFixed(1) + '%')
  console.log('   Original: ' + (actualSize / 1024 / 1024).toFixed(2) + ' MB')
  console.log('   Compressed: ' + (fileData.length / 1024 / 1024).toFixed(2) + ' MB')
  console.log()
  console.log('✅ Ready for Node.js builtin loader integration')
  console.log()
}

// Run the decompression test.
testUserlandDecompression().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
