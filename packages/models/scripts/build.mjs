#!/usr/bin/env node

/**
 * Build script for @socketsecurity/models.
 *
 * Downloads AI models from Hugging Face, converts to ONNX, and applies quantization.
 *
 * Workflow:
 * 1. Download models from Hugging Face (with fallbacks)
 * 2. Convert to ONNX if needed
 * 3. Apply quantization (INT4 or INT8) for compression
 * 4. Output quantized ONNX models
 *
 * Options:
 * --int8   Use INT8 quantization (better compatibility, ~50% size reduction)
 * --int4   Use INT4 quantization (maximum compression, ~75% size reduction, default)
 * --minilm Build MiniLM-L6 model only
 * --codet5 Build CodeT5 model only
 * --all    Build all models
 * --force  Force rebuild even if checkpoints exist
 * --clean  Clean all checkpoints before building
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

// Model selection flags.
const BUILD_MINILM = args.includes('--all') || args.includes('--minilm') || !args.includes('--codet5')
const BUILD_CODET5 = args.includes('--all') || args.includes('--codet5')

// Quantization level (default: INT4 for maximum compression).
const QUANT_LEVEL = args.includes('--int8') ? 'INT8' : 'INT4'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const BUILD = join(ROOT, 'build')
const MODELS = join(BUILD, 'models')
const PACKAGE_NAME = 'models'

// Model sources (with fallbacks and versions).
const MODEL_SOURCES = {
  // MiniLM-L6 for embeddings (primary model).
  'minilm-l6': {
    primary: 'sentence-transformers/all-MiniLM-L6-v2',
    // Pin to specific revision for reproducible builds.
    revision: '7dbbc90392e2f80f3d3c277d6e90027e55de9125',
    fallbacks: [
      'microsoft/all-MiniLM-L6-v2',
      'optimum/all-MiniLM-L6-v2'
    ],
    files: ['model.onnx', 'tokenizer.json'],
    task: 'feature-extraction'
  },
  // CodeT5 for code analysis.
  'codet5': {
    primary: 'Salesforce/codet5-base',
    revision: 'main',
    fallbacks: [
      'Salesforce/codet5-small'
    ],
    files: ['encoder_model.onnx', 'decoder_model.onnx', 'tokenizer.json'],
    task: 'text2text-generation'
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

  const config = MODEL_SOURCES[modelKey]
  const modelDir = join(MODELS, modelKey)

  // Check for expected ONNX files based on model type.
  const expectedFiles = config.files.filter(f => f.endsWith('.onnx'))
  const allExist = expectedFiles.every(f => existsSync(join(modelDir, f)))

  if (allExist) {
    logger.success('Already in ONNX format')
    await createCheckpoint(PACKAGE_NAME, `converted-${modelKey}`, { modelKey })
    return
  }

  // Convert using optimum-cli with task specified.
  try {
    await execAsync(
      `python3 -m optimum.exporters.onnx --model ${modelDir} --task ${config.task} ${modelDir}`,
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
 * Apply quantization for compression.
 *
 * Supports two quantization levels:
 * - INT4: MatMulNBitsQuantizer with RTN weight-only quantization (maximum compression).
 * - INT8: Dynamic quantization (better compatibility, moderate compression).
 *
 * Results in significant size reduction with minimal accuracy loss.
 */
async function quantizeModel(modelKey, quantLevel) {
  const suffix = quantLevel.toLowerCase()
  const checkpointKey = `quantized-${modelKey}-${suffix}`

  if (!(await shouldRun(PACKAGE_NAME, checkpointKey, FORCE_BUILD))) {
    // Return existing quantized paths.
    const modelDir = join(MODELS, modelKey)
    if (modelKey === 'codet5') {
      return [
        join(modelDir, `encoder_model.${suffix}.onnx`),
        join(modelDir, `decoder_model.${suffix}.onnx`)
      ]
    }
    return [join(modelDir, `model.${suffix}.onnx`)]
  }

  logger.step(`Applying ${quantLevel} quantization to ${modelKey}`)

  const modelDir = join(MODELS, modelKey)

  // Different files for codet5 (encoder/decoder) vs minilm (single model).
  const models = modelKey === 'codet5'
    ? [
        { input: 'encoder_model.onnx', output: `encoder_model.${suffix}.onnx` },
        { input: 'decoder_model.onnx', output: `decoder_model.${suffix}.onnx` }
      ]
    : [{ input: 'model.onnx', output: `model.${suffix}.onnx` }]

  const quantizedPaths = []
  let method = quantLevel

  for (const { input, output } of models) {
    const onnxPath = join(modelDir, input)
    const quantPath = join(modelDir, output)

    if (!existsSync(onnxPath)) {
      logger.warn(`No ONNX model found at ${onnxPath}, skipping`)
      continue
    }

    let originalSize
    let quantSize

    try {
      if (quantLevel === 'INT8') {
        // INT8: Use dynamic quantization (simpler, more compatible).
        await execAsync(
          `python3 -c "` +
          `from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
          `quantize_dynamic('${onnxPath}', '${quantPath}', weight_type=QuantType.QUInt8)` +
          `"`,
          { stdio: 'inherit' }
        )
      } else {
        // INT4: Use MatMulNBitsQuantizer (maximum compression).
        await execAsync(
          `python3 -c "` +
          `from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, RTNWeightOnlyQuantConfig; ` +
          `from onnxruntime.quantization import quant_utils; ` +
          `from pathlib import Path; ` +
          `quant_config = RTNWeightOnlyQuantConfig(); ` +
          `model = quant_utils.load_model_with_shape_infer(Path('${onnxPath}')); ` +
          `quant = MatMulNBitsQuantizer(model, algo_config=quant_config); ` +
          `quant.process(); ` +
          `quant.model.save_model_to_file('${quantPath}', True)` +
          `"`,
          { stdio: 'inherit' }
        )
      }

      // Get sizes.
      originalSize = (await readFile(onnxPath)).length
      quantSize = (await readFile(quantPath)).length
      const savings = ((1 - quantSize / originalSize) * 100).toFixed(1)

      logger.substep(`${input}: ${(originalSize / 1024 / 1024).toFixed(2)} MB → ${(quantSize / 1024 / 1024).toFixed(2)} MB (${savings}% savings)`)
    } catch (e) {
      logger.warn(`${quantLevel} quantization failed for ${input}, using FP32 model: ${e.message}`)
      // Copy the original ONNX model as the "quantized" version.
      await copyFile(onnxPath, quantPath)
      method = 'FP32'
      originalSize = (await readFile(onnxPath)).length
      quantSize = originalSize
    }

    quantizedPaths.push(quantPath)
  }

  logger.success(`Quantized to ${method}`)
  await createCheckpoint(PACKAGE_NAME, checkpointKey, {
    modelKey,
    method,
    quantLevel,
  })

  return quantizedPaths
}

/**
 * Copy quantized models and tokenizers to dist.
 */
async function copyToDist(modelKey, quantizedPaths, quantLevel) {
  logger.step('Copying models to dist')

  await mkdir(DIST, { recursive: true })

  const modelDir = join(MODELS, modelKey)
  const suffix = quantLevel.toLowerCase()

  if (modelKey === 'codet5') {
    // CodeT5: encoder, decoder, tokenizer.
    await copyFile(quantizedPaths[0], join(DIST, `codet5-encoder-${suffix}.onnx`))
    await copyFile(quantizedPaths[1], join(DIST, `codet5-decoder-${suffix}.onnx`))
    await copyFile(join(modelDir, 'tokenizer.json'), join(DIST, 'codet5-tokenizer.json'))

    logger.success(`Copied codet5 models (${quantLevel}) to dist/`)
  } else {
    // MiniLM: single model + tokenizer.
    await copyFile(quantizedPaths[0], join(DIST, `minilm-l6-${suffix}.onnx`))
    await copyFile(join(modelDir, 'tokenizer.json'), join(DIST, 'minilm-l6-tokenizer.json'))

    logger.success(`Copied minilm-l6 model (${quantLevel}) to dist/`)
  }
}

/**
 * Main build.
 */
async function main() {
  logger.info('Building @socketsecurity/models')
  logger.info('='.repeat(60))
  logger.info(`Quantization: ${QUANT_LEVEL}`)
  logger.info('')

  const startTime = Date.now()

  const suffix = QUANT_LEVEL.toLowerCase()

  // Clean checkpoints if requested or if output is missing.
  const outputMissing = !existsSync(join(DIST, `minilm-l6-${suffix}.onnx`)) && !existsSync(join(DIST, `codet5-encoder-${suffix}.onnx`))

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      logger.step('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint(PACKAGE_NAME)
  }

  // Create directories.
  await mkdir(DIST, { recursive: true })
  await mkdir(BUILD, { recursive: true })

  try {
    // Build MiniLM-L6 if requested.
    if (BUILD_MINILM) {
      logger.info('')
      logger.info('Building MiniLM-L6...')
      logger.info('-'.repeat(60))

      await downloadModel('minilm-l6')
      await convertToOnnx('minilm-l6')
      const quantizedPaths = await quantizeModel('minilm-l6', QUANT_LEVEL)
      await copyToDist('minilm-l6', quantizedPaths, QUANT_LEVEL)
    }

    // Build CodeT5 if requested.
    if (BUILD_CODET5) {
      logger.info('')
      logger.info('Building CodeT5...')
      logger.info('-'.repeat(60))

      await downloadModel('codet5')
      await convertToOnnx('codet5')
      const quantizedPaths = await quantizeModel('codet5', QUANT_LEVEL)
      await copyToDist('codet5', quantizedPaths, QUANT_LEVEL)
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logger.info('')
    logger.info('='.repeat(60))
    logger.success('Build complete!')
    logger.info('')
    logger.substep(`Duration: ${duration}s`)
    logger.info('')
    logger.substep(`Output: ${DIST}`)

    if (BUILD_MINILM) {
      logger.substep(`  - minilm-l6-${suffix}.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep('  - minilm-l6-tokenizer.json')
    }
    if (BUILD_CODET5) {
      logger.substep(`  - codet5-encoder-${suffix}.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep(`  - codet5-decoder-${suffix}.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep('  - codet5-tokenizer.json')
    }
  } catch (error) {
    logger.info('')
    logger.error(`Build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
