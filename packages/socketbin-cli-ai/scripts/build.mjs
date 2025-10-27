#!/usr/bin/env node

/**
 * Build script for @socketbin/cli-ai.
 *
 * Workflow:
 * 1. Download models from Hugging Face (with fallbacks)
 * 2. Convert to ONNX if needed
 * 3. Apply INT4 quantization for maximum compression
 * 4. Compress with maximum brotli (quality 11)
 * 5. Base64 encode for safe npm transport
 * 6. Build TypeScript API wrapper
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import { logger } from '@socketsecurity/lib/logger'

import {
  cleanCheckpoint,
  createCheckpoint,
  getCheckpointData,
  shouldRun,
} from '@socketsecurity/build-infra/lib/checkpoint-manager'

const execAsync = promisify(exec)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
const CLEAN_BUILD = args.includes('--clean')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const BUILD = join(ROOT, 'build')
const MODELS = join(BUILD, 'models')
const PACKAGE_NAME = 'socketbin-cli-ai'

// Model sources (with fallbacks and versions).
const MODEL_SOURCES = {
  // MiniLM-L6 for embeddings (primary model).
  'minilm-l6': {
    primary: 'sentence-transformers/all-MiniLM-L6-v2',
    // Pin to specific revision for reproducible builds.
    // Update this SHA when upgrading to new model version.
    revision: '7dbbc90392e2f80f3d3c277d6e90027e55de9125',
    fallbacks: [
      'microsoft/all-MiniLM-L6-v2',
      'optimum/all-MiniLM-L6-v2'
    ],
    files: ['model.onnx', 'tokenizer.json']
  },
  // CodeT5 for code analysis (optional, larger).
  'codet5': {
    primary: 'Salesforce/codet5-base',
    revision: 'main', // Use latest from main branch.
    fallbacks: [
      'Salesforce/codet5-small'
    ],
    files: ['encoder_model.onnx', 'decoder_model.onnx', 'tokenizer.json']
  }
}

/**
 * Download model from Hugging Face.
 */
async function downloadModel(modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `downloaded-${modelKey}`, FORCE_BUILD))) {
    return
  }

  logger.log(`\n📥 Downloading ${modelKey} model...`)

  const config = MODEL_SOURCES[modelKey]
  const sources = [config.primary, ...config.fallbacks]
  const revision = config.revision

  for (const source of sources) {
    try {
      logger.log(`  Trying: ${source}@${revision}`)

      await mkdir(MODELS, { recursive: true })

      // Download using huggingface-cli (fastest) or fallback to Python.
      try {
        // Try huggingface-cli first.
        const revisionFlag = revision ? `--revision=${revision}` : ''
        await execAsync(
          `huggingface-cli download ${source} ${revisionFlag} --local-dir ${MODELS}/${modelKey}`,
          { stdio: 'inherit' }
        )
        logger.log(`  ✓ Downloaded from ${source}`)
        await createCheckpoint(PACKAGE_NAME, `downloaded-${modelKey}`, {
          source,
          revision,
          modelKey,
        })
        return
      } catch {
        // Fallback to Python transformers.
        const revisionParam = revision ? `, revision='${revision}'` : ''
        await execAsync(
          `python3 -c "from transformers import AutoTokenizer, AutoModel; ` +
          `tokenizer = AutoTokenizer.from_pretrained('${source}'${revisionParam}); ` +
          `model = AutoModel.from_pretrained('${source}'${revisionParam}); ` +
          `tokenizer.save_pretrained('${MODELS}/${modelKey}'); ` +
          `model.save_pretrained('${MODELS}/${modelKey}')"`
        )
        logger.log(`  ✓ Downloaded from ${source}`)
        await createCheckpoint(PACKAGE_NAME, `downloaded-${modelKey}`, {
          source,
          revision,
          modelKey,
        })
        return
      }
    } catch (e) {
      logger.log(`  ✗ Failed: ${source}`)
      // Continue to next fallback.
    }
  }

  throw new Error(`Failed to download ${modelKey} from all sources`)
}

/**
 * Convert model to ONNX if needed.
 */
async function convertToOnnx(modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `converted-${modelKey}`, FORCE_BUILD))) {
    return
  }

  logger.log(`\n🔄 Converting ${modelKey} to ONNX...`)

  const modelDir = join(MODELS, modelKey)
  const onnxPath = join(modelDir, 'model.onnx')

  if (existsSync(onnxPath)) {
    logger.log('  ✓ Already in ONNX format')
    await createCheckpoint(PACKAGE_NAME, `converted-${modelKey}`, { modelKey })
    return
  }

  // Convert using optimum-cli or Python.
  try {
    await execAsync(
      `python3 -m optimum.exporters.onnx --model ${modelDir} ${modelDir}`,
      { stdio: 'inherit' }
    )
    logger.log('  ✓ Converted to ONNX')
    await createCheckpoint(PACKAGE_NAME, `converted-${modelKey}`, { modelKey })
  } catch (e) {
    logger.error('  ✗ Conversion failed:', e.message)
    throw e
  }
}

/**
 * Apply INT4 quantization for maximum compression.
 */
async function quantizeInt4(modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `quantized-${modelKey}`, FORCE_BUILD))) {
    // Return existing quantized path.
    const modelDir = join(MODELS, modelKey)
    return join(modelDir, 'model.int4.onnx')
  }

  logger.log(`\n⚙️  Applying INT4 quantization to ${modelKey}...`)

  const modelDir = join(MODELS, modelKey)
  const onnxPath = join(modelDir, 'model.onnx')
  const quantPath = join(modelDir, 'model.int4.onnx')

  if (!existsSync(onnxPath)) {
    logger.log('  ⚠️  No ONNX model found, skipping')
    return
  }

  try {
    // Use ONNX Runtime's MatMulNBits quantization for INT4.
    // This is more aggressive than INT8 - reduces size by ~75%.
    await execAsync(
      `python3 -c "` +
      `from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
      `from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer; ` +
      `quantizer = MatMulNBitsQuantizer('${onnxPath}', 4, is_symmetric=True); ` +
      `quantizer.process(); ` +
      `quantizer.model.save('${quantPath}')` +
      `"`,
      { stdio: 'inherit' }
    )

    // Get sizes.
    const originalSize = (await readFile(onnxPath)).length
    const quantSize = (await readFile(quantPath)).length
    const savings = ((1 - quantSize / originalSize) * 100).toFixed(1)

    logger.log(`  Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)
    logger.log(`  INT4: ${(quantSize / 1024 / 1024).toFixed(2)} MB`)
    logger.log(`  Savings: ${savings}%`)

    logger.log('  ✓ Quantized to INT4')
    await createCheckpoint(PACKAGE_NAME, `quantized-${modelKey}`, {
      modelKey,
      method: 'INT4',
      originalSize,
      quantizedSize: quantSize,
    })
    return quantPath
  } catch (e) {
    logger.log('  ⚠️  INT4 quantization failed, falling back to INT8...')

    // Fallback to INT8 quantization.
    await execAsync(
      `python3 -c "from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
      `quantize_dynamic('${onnxPath}', '${quantPath}', weight_type=QuantType.QInt8)"`,
      { stdio: 'inherit' }
    )

    const originalSize = (await readFile(onnxPath)).length
    const quantSize = (await readFile(quantPath)).length
    const savings = ((1 - quantSize / originalSize) * 100).toFixed(1)

    logger.log(`  Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)
    logger.log(`  INT8: ${(quantSize / 1024 / 1024).toFixed(2)} MB`)
    logger.log(`  Savings: ${savings}%`)

    logger.log('  ✓ Quantized to INT8')
    await createCheckpoint(PACKAGE_NAME, `quantized-${modelKey}`, {
      modelKey,
      method: 'INT8',
      originalSize,
      quantizedSize: quantSize,
    })
    return quantPath
  }
}

/**
 * Compress WASM with maximum brotli compression.
 */
async function compressWasm(wasmPath, modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `compressed-${modelKey}`, FORCE_BUILD))) {
    return
  }

  logger.log('\n🗜️  Compressing with maximum brotli...')

  const wasmBuffer = await readFile(wasmPath)
  const originalSize = wasmBuffer.length

  logger.log(`  Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)

  // Compress with maximum brotli quality (level 11).
  // BROTLI_MODE_GENERIC: Optimized for binary data.
  const compressed = brotliCompressSync(wasmBuffer, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
    },
  })

  const compressedSize = compressed.length
  const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1)

  logger.log(`  Compressed: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`)
  logger.log(`  Ratio: ${ratio}% savings`)

  // Base64 encode.
  const base64 = compressed.toString('base64')
  const base64Size = Buffer.byteLength(base64, 'utf8')
  const overhead = ((base64Size / compressedSize - 1) * 100).toFixed(1)

  logger.log(
    `  Base64: ${(base64Size / 1024 / 1024).toFixed(2)} MB (+${overhead}% overhead)`,
  )

  // Write .bz file.
  await writeFile(join(DIST, 'ai.bz'), base64, 'utf8')

  logger.log('  ✓ Compressed and encoded')
  await createCheckpoint(PACKAGE_NAME, `compressed-${modelKey}`, {
    modelKey,
    originalSize,
    compressedSize,
    base64Size,
  })
}

/**
 * Build TypeScript with esbuild.
 */
async function buildTypeScript() {
  logger.log('\n📦 Building TypeScript API...')

  const esbuild = await import('esbuild')

  await esbuild.build({
    entryPoints: [join(ROOT, 'src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: join(DIST, 'ai.js'),
    minify: true,
    sourcemap: false,
  })

  logger.log('  ✓ TypeScript built')
}

/**
 * Main build.
 */
async function main() {
  logger.log('🚀 Building @socketbin/cli-ai')
  logger.log('='.repeat(60))

  const startTime = Date.now()

  // Clean checkpoints if requested.
  if (CLEAN_BUILD) {
    logger.log('\n🧹 Cleaning build checkpoints...')
    await cleanCheckpoint(PACKAGE_NAME)
  }

  // Create directories.
  await mkdir(DIST, { recursive: true })
  await mkdir(BUILD, { recursive: true })

  // Use MiniLM-L6 as primary model (good balance of size/accuracy).
  const modelKey = 'minilm-l6'

  try {
    // Download model.
    await downloadModel(modelKey)

    // Convert to ONNX if needed.
    await convertToOnnx(modelKey)

    // Apply INT4 quantization.
    const quantPath = await quantizeInt4(modelKey)

    // Compress with maximum brotli.
    await compressWasm(quantPath, modelKey)

    // Build TypeScript API.
    await buildTypeScript()

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logger.log('\n' + '='.repeat(60))
    logger.log('✅ Build complete!')
    logger.log(`\n⏱️  Duration: ${duration}s`)
    logger.log(`\n📁 Output: ${DIST}`)
    logger.log('   - ai.js (JavaScript API)')
    logger.log('   - ai.bz (Compressed WASM)')
  } catch (error) {
    logger.error('\n❌ Build failed:', error.message)
    process.exit(1)
  }
}

main()
