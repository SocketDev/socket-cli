/**
 * Download all model assets for unified WASM bundle.
 *
 * WHAT THIS DOWNLOADS:
 * 1. MiniLM model (int8 quantized, ~17MB)
 * 2. MiniLM tokenizer (~500KB)
 * 3. CodeT5 encoder (int4 quantized, ~30MB)
 * 4. CodeT5 decoder (int4 quantized, ~60MB)
 * 5. CodeT5 tokenizer (~500KB)
 * 6. ONNX Runtime WASM (~2-5MB)
 * 7. Yoga Layout WASM (~95KB) - copied from node_modules
 *
 * OUTPUT:
 * All files saved to .cache/models/
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const cacheDir = path.join(rootPath, '.cache/models')

// Model sources.
const MINILM_REPO = 'Xenova/paraphrase-MiniLM-L3-v2'
const MINILM_BASE = `https://huggingface.co/${MINILM_REPO}/resolve/main`

const CODET5_REPO = 'Salesforce/codet5-small'
const _CODET5_BASE = `https://huggingface.co/${CODET5_REPO}/resolve/main`

// NOTE: CodeT5 ONNX files don't exist yet on HuggingFace.
// For now, we'll use placeholder URLs - these need to be converted first.
// See scripts/wasm/convert-codet5.mjs for conversion process.

const FILES = [
  // MiniLM (already quantized on HuggingFace).
  {
    description: 'MiniLM model (int8)',
    name: 'minilm-int8.onnx',
    url: `${MINILM_BASE}/onnx/model_quantized.onnx`,
  },
  {
    description: 'MiniLM tokenizer',
    name: 'minilm-tokenizer.json',
    url: `${MINILM_BASE}/tokenizer.json`,
  },

  // CodeT5 (needs manual conversion first - see convert-codet5.mjs).
  {
    copyFrom: null, // Set after conversion
    description: 'CodeT5 encoder (int4)',
    name: 'codet5-encoder-int4.onnx',
    url: null, // Needs conversion first
  },
  {
    copyFrom: null,
    description: 'CodeT5 decoder (int4)',
    name: 'codet5-decoder-int4.onnx',
    url: null, // Needs conversion first
  },
  {
    description: 'CodeT5 tokenizer',
    name: 'codet5-tokenizer.json',
    url: null, // Will be created by convert-codet5.mjs
  },

  // ONNX Runtime WASM (from node_modules).
  {
    copyFrom: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    description: 'ONNX Runtime WASM',
    name: 'ort-wasm-simd-threaded.wasm',
    url: null,
  },

  // Yoga Layout WASM (extracted from base64).
  {
    extractYoga: true,
    description: 'Yoga Layout WASM',
    name: 'yoga.wasm',
    url: null,
  },
]

/**
 * Download file with progress.
 */
async function downloadFile(url, outputPath, description) {
  console.log(`📦 Downloading ${description}...`)
  console.log(`   URL: ${url}`)

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()

  await fs.writeFile(outputPath, Buffer.from(buffer))

  const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(2)
  console.log(`   ✓ Downloaded ${sizeMB} MB`)
  console.log(`   ✓ Saved to ${outputPath}\n`)

  return buffer.byteLength
}

/**
 * Copy file from source to dest.
 */
async function copyFile(source, dest, description) {
  console.log(`📋 Copying ${description}...`)
  console.log(`   From: ${source}`)

  const fullSource = path.join(rootPath, source)

  if (!existsSync(fullSource)) {
    throw new Error(`Source file not found: ${fullSource}`)
  }

  const buffer = await fs.readFile(fullSource)
  await fs.writeFile(dest, buffer)

  const sizeKB = (buffer.length / 1024).toFixed(2)
  console.log(`   ✓ Copied ${sizeKB} KB`)
  console.log(`   ✓ Saved to ${dest}\n`)

  return buffer.length
}

/**
 * Extract yoga WASM from base64-encoded file.
 */
async function extractYogaWasm(dest, description) {
  console.log(`📦 Extracting ${description}...`)

  const yogaBase64File = path.join(
    rootPath,
    'node_modules/yoga-layout/dist/binaries/yoga-wasm-base64-esm.js',
  )

  if (!existsSync(yogaBase64File)) {
    throw new Error(`yoga-layout not installed: ${yogaBase64File}`)
  }

  const content = await fs.readFile(yogaBase64File, 'utf-8')

  // Extract base64 WASM data.
  // Pattern: H="data:application/octet-stream;base64,<BASE64DATA>"
  const match = content.match(
    /H="data:application\/octet-stream;base64,([^"]+)"/,
  )

  if (!match) {
    throw new Error(
      'Could not find WASM base64 data in yoga-layout binary file',
    )
  }

  const base64Data = match[1]
  const wasmBuffer = Buffer.from(base64Data, 'base64')

  await fs.writeFile(dest, wasmBuffer)

  const sizeKB = (wasmBuffer.length / 1024).toFixed(2)
  console.log(`   ✓ Extracted ${sizeKB} KB`)
  console.log(`   ✓ Saved to ${dest}\n`)

  return wasmBuffer.length
}

/**
 * Main download logic.
 */
export async function downloadModels() {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Download Model Assets                           ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')

  // Create cache directory.
  await fs.mkdir(cacheDir, { recursive: true })
  console.log(`✓ Cache directory: ${cacheDir}\n`)

  let totalBytes = 0
  const missing = []

  // Download/copy each file.
  for (const file of FILES) {
    const outputPath = path.join(cacheDir, file.name)

    // Check if file already exists.
    try {
      await fs.access(outputPath)
      const stats = await fs.stat(outputPath)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      console.log(`✓ ${file.description} already exists (${sizeMB} MB)`)
      console.log(`   ${outputPath}\n`)
      totalBytes += stats.size
      continue
    } catch {
      // File doesn't exist - download or copy it.
    }

    // Check if this is a copy operation.
    if (file.copyFrom) {
      try {
        const bytes = await copyFile(
          file.copyFrom,
          outputPath,
          file.description,
        )
        totalBytes += bytes
      } catch (e) {
        console.error(`   ✗ Failed to copy: ${e.message}`)
        console.error(
          '   Please ensure dependencies are installed: pnpm install\n',
        )
        missing.push(file.name)
      }
      continue
    }

    // Check if this is yoga extraction.
    if (file.extractYoga) {
      try {
        const bytes = await extractYogaWasm(outputPath, file.description)
        totalBytes += bytes
      } catch (e) {
        console.error(`   ✗ Failed to extract: ${e.message}`)
        console.error(
          '   Please ensure yoga-layout is installed: pnpm install\n',
        )
        missing.push(file.name)
      }
      continue
    }

    // Check if URL is provided.
    if (!file.url) {
      console.log(`⚠ ${file.description} needs manual setup`)
      console.log(`   File: ${file.name}`)
      console.log('   Run: node scripts/wasm/convert-codet5.mjs\n')
      missing.push(file.name)
      continue
    }

    // Download file.
    try {
      const bytes = await downloadFile(file.url, outputPath, file.description)
      totalBytes += bytes
    } catch (e) {
      console.error(`   ✗ Download failed: ${e.message}\n`)
      missing.push(file.name)
    }
  }

  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Download Summary                                ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')
  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)

  if (missing.length > 0) {
    console.log(`\n⚠ Missing files (${missing.length}):`)
    for (const file of missing) {
      console.log(`   - ${file}`)
    }
    console.log('\nNext steps:')
    console.log('  1. For CodeT5 models: node scripts/wasm/convert-codet5.mjs')
    console.log('  2. For node_modules files: pnpm install')
    return false
  }

  console.log('\n✓ All files downloaded successfully')
  return true
}

// Run if called directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = await downloadModels()
  process.exit(success ? 0 : 1)
}
