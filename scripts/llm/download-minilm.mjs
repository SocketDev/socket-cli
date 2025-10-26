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
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

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
  logger.log(`📦 Downloading ${description}...`)
  logger.log(`   URL: ${url}`)

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()

  await fs.writeFile(outputPath, Buffer.from(buffer))

  const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(2)
  logger.log(`   ✓ Downloaded ${sizeMB} MB`)
  logger.log(`   ✓ Saved to ${outputPath}\n`)

  return buffer.byteLength
}

/**
 * Main download logic.
 */
async function main() {
  logger.log('╔═══════════════════════════════════════════════════╗')
  logger.log('║   Download MiniLM Model for Socket CLI           ║')
  logger.log('╚═══════════════════════════════════════════════════╝\n')

  // Create cache directory.
  await fs.mkdir(cacheDir, { recursive: true })
  logger.log(`✓ Cache directory: ${cacheDir}\n`)

  let totalBytes = 0

  // Download each file.
  for (const file of FILES) {
    const outputPath = path.join(cacheDir, file.name)

    // Check if file already exists.
    try {
      await fs.access(outputPath)
      const stats = await fs.stat(outputPath)
      logger.log(
        `✓ ${file.description} already exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
      )
      logger.log(`   ${outputPath}\n`)
      totalBytes += stats.size
      continue
    } catch {
      // File doesn't exist - download it.
    }

    const bytes = await downloadFile(file.url, outputPath, file.description)
    totalBytes += bytes
  }

  logger.log('╔═══════════════════════════════════════════════════╗')
  logger.log('║   Download Complete                               ║')
  logger.log('╚═══════════════════════════════════════════════════╝\n')
  logger.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  logger.log('\nNext steps:')
  logger.log('  1. Run: node scripts/llm/embed-minilm.mjs')
  logger.log(
    '  2. This will create external/minilm-sync.mjs with embedded model',
  )
}

main().catch(error => {
  logger.error(`${colors.red('✗')} Download failed:`, error.message)
  process.exit(1)
})
