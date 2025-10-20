/**
 * Download MiniLM Model Assets
 *
 * Downloads paraphrase-MiniLM-L3-v2 vocabulary and model from Hugging Face.
 *
 * WHAT IT DOWNLOADS:
 * 1. tokenizer.json - WordPiece vocabulary (~500KB)
 * 2. model_quantized.onnx - Quantized model weights (~17MB)
 *
 * WHY QUANTIZED:
 * - 8-bit quantization reduces size by ~4x (68MB → 17MB)
 * - Minimal accuracy loss (<1%)
 * - Faster inference on CPU
 *
 * MODEL INFO:
 * - Name: sentence-transformers/paraphrase-MiniLM-L3-v2
 * - Type: Sentence transformer for semantic similarity
 * - Layers: 3 (L3 = lightweight)
 * - Embedding dim: 384
 * - Vocab size: 30,522 tokens
 *
 * OUTPUT:
 * - .cache/models/tokenizer.json
 * - .cache/models/model_quantized.onnx
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '../..')
const cacheDir = path.join(rootPath, '.cache/models')

// Hugging Face model repository.
const MODEL_REPO = 'Xenova/paraphrase-MiniLM-L3-v2'
const BASE_URL = `https://huggingface.co/${MODEL_REPO}/resolve/main`

// Files to download.
const FILES = [
  {
    name: 'tokenizer.json',
    url: `${BASE_URL}/tokenizer.json`,
    description: 'WordPiece vocabulary',
  },
  {
    name: 'model_quantized.onnx',
    url: `${BASE_URL}/onnx/model_quantized.onnx`,
    description: 'Quantized ONNX model',
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
 * Main download logic.
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Download MiniLM Model for Socket CLI           ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')

  // Create cache directory.
  await fs.mkdir(cacheDir, { recursive: true })
  console.log(`✓ Cache directory: ${cacheDir}\n`)

  let totalBytes = 0

  // Download each file.
  for (const file of FILES) {
    const outputPath = path.join(cacheDir, file.name)

    // Check if file already exists.
    try {
      await fs.access(outputPath)
      const stats = await fs.stat(outputPath)
      console.log(`✓ ${file.description} already exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`)
      console.log(`   ${outputPath}\n`)
      totalBytes += stats.size
      continue
    } catch {
      // File doesn't exist - download it.
    }

    const bytes = await downloadFile(file.url, outputPath, file.description)
    totalBytes += bytes
  }

  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║   Download Complete                               ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')
  console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  console.log('\nNext steps:')
  console.log('  1. Run: node scripts/llm/embed-minilm.mjs')
  console.log('  2. This will create external/minilm-sync.mjs with embedded model')
}

main().catch(error => {
  console.error('❌ Download failed:', error.message)
  process.exit(1)
})
