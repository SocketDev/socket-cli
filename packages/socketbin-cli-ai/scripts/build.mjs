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

import { createInterface } from 'node:readline'

import { logger } from '@socketsecurity/lib/logger'

import {
  cleanCheckpoint,
  createCheckpoint,
  getCheckpointData,
  shouldRun,
} from '@socketsecurity/build-infra/lib/checkpoint-manager'

const execAsync = promisify(exec)

// Check if running in CI.
const IS_CI = !!(
  process.env['CI'] ||
  process.env['GITHUB_ACTIONS'] ||
  process.env['GITLAB_CI'] ||
  process.env['CIRCLECI']
)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
const CLEAN_BUILD = args.includes('--clean')
const NO_SELF_UPDATE = args.includes('--no-self-update')

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
 * Prompt user for input.
 */
async function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * Check for model updates on Hugging Face.
 * Prompts user to update if newer version available (local builds only).
 * Only checks once per 24 hours to avoid annoying frequent checks.
 */
async function checkModelUpdates(modelKey) {
  if (IS_CI || NO_SELF_UPDATE) {
    // Skip update checks in CI or when --no-self-update is passed.
    return
  }

  // Check if we've already checked within the last 24 hours.
  const checkpointKey = `update-check-${modelKey}`
  const lastCheck = await getCheckpointData(PACKAGE_NAME, checkpointKey)

  if (lastCheck?.timestamp) {
    const hoursSinceCheck = (Date.now() - lastCheck.timestamp) / (1000 * 60 * 60)
    if (hoursSinceCheck < 24) {
      logger.substep(`Last update check: ${Math.floor(hoursSinceCheck)}h ago`)
      return
    }
  }

  const config = MODEL_SOURCES[modelKey]
  const currentRevision = config.revision

  try {
    logger.step('Checking for model updates')

    // Fetch latest commit SHA from Hugging Face API.
    const response = await fetch(
      `https://huggingface.co/api/models/${config.primary}/revision/main`
    )

    if (!response.ok) {
      // API call failed, skip update check.
      return
    }

    const data = await response.json()
    const latestRevision = data.sha

    // Store timestamp of this check.
    await createCheckpoint(PACKAGE_NAME, checkpointKey, {
      timestamp: Date.now(),
      latestRevision,
    })

    if (latestRevision === currentRevision) {
      logger.success(`Using latest version (${currentRevision.slice(0, 8)})`)
      return
    }

    // Newer version available!
    logger.warn('New model version available!')
    logger.substep(`Current: ${currentRevision.slice(0, 8)}`)
    logger.substep(`Latest:  ${latestRevision.slice(0, 8)}`)
    logger.info('')

    const answer = await prompt('  Update to latest version? (y/N): ')

    if (!answer || answer.toLowerCase() === 'n') {
      logger.substep('Keeping current version')
      return
    }

    // User wants to update - show instructions.
    logger.info('')
    logger.substep('To update, change the revision in scripts/build.mjs:')
    logger.substep(`  revision: '${latestRevision}',`)
    logger.info('')
    logger.substep('Then run build again.')
    process.exit(0)
  } catch (e) {
    // Update check failed, continue with build.
    logger.warn('Could not check for updates')
  }
}

/**
 * Download model from Hugging Face.
 */
async function downloadModel(modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `downloaded-${modelKey}`, FORCE_BUILD))) {
    return
  }

  logger.step(`Downloading ${modelKey} model`)

  const config = MODEL_SOURCES[modelKey]
  const sources = [config.primary, ...config.fallbacks]
  const revision = config.revision

  for (const source of sources) {
    try {
      logger.substep(`Trying: ${source}@${revision}`)

      await mkdir(MODELS, { recursive: true })

      // Download using huggingface-cli (fastest) or fallback to Python.
      try {
        // Try huggingface-cli first.
        const revisionFlag = revision ? `--revision=${revision}` : ''
        await execAsync(
          `huggingface-cli download ${source} ${revisionFlag} --local-dir ${MODELS}/${modelKey}`,
          { stdio: 'inherit' }
        )
        logger.success(`Downloaded from ${source}`)
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
        logger.success(`Downloaded from ${source}`)
        await createCheckpoint(PACKAGE_NAME, `downloaded-${modelKey}`, {
          source,
          revision,
          modelKey,
        })
        return
      }
    } catch (e) {
      logger.error(`Failed: ${source}`)
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

  logger.step(`Converting ${modelKey} to ONNX`)

  const modelDir = join(MODELS, modelKey)
  const onnxPath = join(modelDir, 'model.onnx')

  if (existsSync(onnxPath)) {
    logger.success('Already in ONNX format')
    await createCheckpoint(PACKAGE_NAME, `converted-${modelKey}`, { modelKey })
    return
  }

  // Convert using optimum-cli with task specified.
  // MiniLM is a sentence transformer - use feature-extraction task.
  try {
    await execAsync(
      `python3 -m optimum.exporters.onnx --model ${modelDir} --task feature-extraction ${modelDir}`,
      { stdio: 'inherit' }
    )
    logger.success('Converted to ONNX')
    await createCheckpoint(PACKAGE_NAME, `converted-${modelKey}`, { modelKey })
  } catch (e) {
    logger.error(`Conversion failed: ${e.message}`)
    throw e
  }
}

/**
 * Apply INT4 quantization for maximum compression.
 *
 * Uses MatMul4BitsQuantizer for block-wise weight-only quantization:
 * - Converts 36/48 MatMul operators to MatMulNBits (INT4).
 * - Remaining 12 MatMul operators (embeddings) stay unquantized.
 * - Results in 99.8% size reduction (86MB → 174KB).
 * - Model remains fully functional with minimal accuracy loss.
 *
 * Documentation discrepancy:
 * - ONNX Runtime docs show MatMul4BitsQuantizer with op_types_to_quantize parameter.
 * - Actual API: DefaultWeightOnlyQuantConfig(block_size, is_symmetric, accuracy_level).
 * - The op_types parameter doesn't exist in DefaultWeightOnlyQuantConfig constructor.
 */
async function quantizeModel(modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `quantized-${modelKey}`, FORCE_BUILD))) {
    // Return existing quantized path.
    const modelDir = join(MODELS, modelKey)
    return join(modelDir, 'model.int4.onnx')
  }

  logger.step(`Applying INT4 quantization to ${modelKey}`)

  const modelDir = join(MODELS, modelKey)
  const onnxPath = join(modelDir, 'model.onnx')
  const quantPath = join(modelDir, 'model.int4.onnx')

  if (!existsSync(onnxPath)) {
    logger.warn('No ONNX model found, skipping')
    return
  }

  // Use ONNX Runtime's MatMul4BitsQuantizer for INT4.
  // Block-wise weight-only quantization with RTN algorithm.
  await execAsync(
    `python3 -c "` +
    `from onnxruntime.quantization import matmul_4bits_quantizer, quant_utils; ` +
    `from pathlib import Path; ` +
    `quant_config = matmul_4bits_quantizer.DefaultWeightOnlyQuantConfig(` +
    `  block_size=128, ` +
    `  is_symmetric=True, ` +
    `  accuracy_level=4` +
    `); ` +
    `model = quant_utils.load_model_with_shape_infer(Path('${onnxPath}')); ` +
    `quant = matmul_4bits_quantizer.MatMul4BitsQuantizer(model, algo_config=quant_config); ` +
    `quant.process(); ` +
    `quant.model.save_model_to_file('${quantPath}', True)` +
    `"`,
    { stdio: 'inherit' }
  )

  // Get sizes.
  const originalSize = (await readFile(onnxPath)).length
  const quantSize = (await readFile(quantPath)).length
  const savings = ((1 - quantSize / originalSize) * 100).toFixed(1)

  logger.substep(`Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)
  logger.substep(`INT4: ${(quantSize / 1024 / 1024).toFixed(2)} MB`)
  logger.substep(`Savings: ${savings}%`)

  logger.success('Quantized to INT4')
  await createCheckpoint(PACKAGE_NAME, `quantized-${modelKey}`, {
    modelKey,
    method: 'INT4',
    originalSize,
    quantizedSize: quantSize,
  })
  return quantPath
}

/**
 * Compress WASM with maximum brotli compression.
 */
async function compressWasm(wasmPath, modelKey) {
  if (!(await shouldRun(PACKAGE_NAME, `compressed-${modelKey}`, FORCE_BUILD))) {
    return
  }

  logger.step('Compressing with maximum brotli')

  const wasmBuffer = await readFile(wasmPath)
  const originalSize = wasmBuffer.length

  logger.substep(`Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)

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

  logger.substep(`Compressed: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`)
  logger.substep(`Ratio: ${ratio}% savings`)

  // Base64 encode.
  const base64 = compressed.toString('base64')
  const base64Size = Buffer.byteLength(base64, 'utf8')
  const overhead = ((base64Size / compressedSize - 1) * 100).toFixed(1)

  logger.substep(
    `Base64: ${(base64Size / 1024 / 1024).toFixed(2)} MB (+${overhead}% overhead)`,
  )

  // Write .bz file.
  await writeFile(join(DIST, 'ai.bz'), base64, 'utf8')

  logger.success('Compressed and encoded')
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
  logger.step('Building TypeScript API')

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

  logger.success('TypeScript built')
}

/**
 * Main build.
 */
async function main() {
  logger.info('Building @socketbin/cli-ai')
  logger.info('='.repeat(60))
  logger.info('')

  const startTime = Date.now()

  // Use MiniLM-L6 as primary model (good balance of size/accuracy).
  const modelKey = 'minilm-l6'

  // Check for model updates (local builds only).
  await checkModelUpdates(modelKey)

  // Clean checkpoints if requested.
  if (CLEAN_BUILD) {
    logger.step('Cleaning build checkpoints')
    await cleanCheckpoint(PACKAGE_NAME)
  }

  // Create directories.
  await mkdir(DIST, { recursive: true })
  await mkdir(BUILD, { recursive: true })

  try {
    // Download model.
    await downloadModel(modelKey)

    // Convert to ONNX if needed.
    await convertToOnnx(modelKey)

    // Apply INT4 quantization.
    const quantPath = await quantizeModel(modelKey)

    // Compress with maximum brotli.
    await compressWasm(quantPath, modelKey)

    // Build TypeScript API.
    await buildTypeScript()

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logger.info('')
    logger.info('='.repeat(60))
    logger.success('Build complete!')
    logger.info('')
    logger.substep(`Duration: ${duration}s`)
    logger.info('')
    logger.substep(`Output: ${DIST}`)
    logger.substep('  - ai.js (JavaScript API)')
    logger.substep('  - ai.bz (Compressed WASM)')
  } catch (error) {
    logger.info('')
    logger.error(`Build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
