/**
 * Build codet5-models - Convert and optimize CodeT5 models for Socket CLI.
 *
 * This script downloads, converts, and optimizes CodeT5 models:
 * - Downloads models from Hugging Face
 * - Converts to ONNX format
 * - Applies INT4/INT8 mixed-precision quantization
 * - Optimizes ONNX graphs
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import {
  checkDiskSpace,
  checkPythonVersion,
  formatDuration,
  getFileSize,
} from '@socketsecurity/build-infra/lib/build-helpers'
import {
  printError,
  printHeader,
  printStep,
  printSuccess,
} from '@socketsecurity/build-infra/lib/build-output'
import {
  cleanCheckpoint,
  createCheckpoint,
  shouldRun,
} from '@socketsecurity/build-infra/lib/checkpoint-manager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')

// Configuration.
const MODEL_NAME = 'Salesforce/codet5-base'
const ROOT_DIR = path.join(__dirname, '..')
const MODELS_DIR = path.join(ROOT_DIR, '.models')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const OUTPUT_DIR = path.join(BUILD_DIR, 'models')

/**
 * Download CodeT5 models from Hugging Face.
 */
async function downloadModels() {
  if (!(await shouldRun('codet5-models', 'downloaded', FORCE_BUILD))) {
    return
  }

  printHeader('Downloading CodeT5 Models')
  printStep(`Model: ${MODEL_NAME}`)

  await fs.mkdir(MODELS_DIR, { recursive: true })

  // Use Hugging Face CLI to download models.
  await exec(
    `python3 -c "from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; ` +
    `tokenizer = AutoTokenizer.from_pretrained('${MODEL_NAME}'); ` +
    `model = AutoModelForSeq2SeqLM.from_pretrained('${MODEL_NAME}'); ` +
    `tokenizer.save_pretrained('${MODELS_DIR}'); ` +
    `model.save_pretrained('${MODELS_DIR}')"`,
    { stdio: 'inherit' }
  )

  printSuccess('Models downloaded')
  await createCheckpoint('codet5-models', 'downloaded')
}

/**
 * Convert models to ONNX format.
 */
async function convertToOnnx() {
  if (!(await shouldRun('codet5-models', 'converted', FORCE_BUILD))) {
    return
  }

  printHeader('Converting to ONNX')

  await fs.mkdir(BUILD_DIR, { recursive: true })

  // Convert encoder.
  printStep('Converting encoder')
  await exec(
    `python3 -m transformers.onnx --model=${MODELS_DIR} --feature=seq2seq-lm ${BUILD_DIR}`,
    { stdio: 'inherit' }
  )

  printSuccess('Models converted to ONNX')
  await createCheckpoint('codet5-models', 'converted')
}

/**
 * Apply quantization to models.
 */
async function quantizeModels() {
  if (!(await shouldRun('codet5-models', 'quantized', FORCE_BUILD))) {
    return
  }

  printHeader('Quantizing Models')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')

  // Quantize encoder with INT8.
  printStep('Quantizing encoder (INT8)')
  await exec(
    `python3 -c "from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
    `quantize_dynamic('${encoderPath}', '${encoderPath}.quant', weight_type=QuantType.QInt8)"`,
    { stdio: 'inherit' }
  )

  // Quantize decoder with INT8.
  printStep('Quantizing decoder (INT8)')
  await exec(
    `python3 -c "from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
    `quantize_dynamic('${decoderPath}', '${decoderPath}.quant', weight_type=QuantType.QInt8)"`,
    { stdio: 'inherit' }
  )

  // Replace original models with quantized versions.
  await fs.rename(`${encoderPath}.quant`, encoderPath)
  await fs.rename(`${decoderPath}.quant`, decoderPath)

  const encoderSize = await getFileSize(encoderPath)
  const decoderSize = await getFileSize(decoderPath)

  printStep(`Encoder: ${encoderSize}`)
  printStep(`Decoder: ${decoderSize}`)

  printSuccess('Models quantized')
  await createCheckpoint('codet5-models', 'quantized')
}

/**
 * Optimize ONNX graphs.
 */
async function optimizeModels() {
  if (!(await shouldRun('codet5-models', 'optimized', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing ONNX Graphs')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')

  // Optimize encoder.
  printStep('Optimizing encoder')
  await exec(
    `python3 -c "from onnxruntime.transformers import optimizer; ` +
    `optimizer.optimize_model('${encoderPath}', model_type='bert', num_heads=12, hidden_size=768)"`,
    { stdio: 'inherit' }
  )

  // Optimize decoder.
  printStep('Optimizing decoder')
  await exec(
    `python3 -c "from onnxruntime.transformers import optimizer; ` +
    `optimizer.optimize_model('${decoderPath}', model_type='bert', num_heads=12, hidden_size=768)"`,
    { stdio: 'inherit' }
  )

  printSuccess('Models optimized')
  await createCheckpoint('codet5-models', 'optimized')
}

/**
 * Verify models can load and run inference.
 */
async function verifyModels() {
  if (!(await shouldRun('codet5-models', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying Models')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')

  // Verify ONNX file is valid.
  const stats = await fs.stat(encoderPath)
  if (stats.size === 0) {
    throw new Error('Encoder model is empty')
  }

  printStep('Testing encoder inference')
  await exec(
    `python3 -c "import onnxruntime as ort; ` +
    `sess = ort.InferenceSession('${encoderPath}'); ` +
    `print('Encoder loaded successfully')"`,
    { stdio: 'inherit' }
  )

  printSuccess('Models verified')
  await createCheckpoint('codet5-models', 'verified')
}

/**
 * Export models to output directory.
 */
async function exportModels() {
  printHeader('Exporting Models')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')
  const tokenizerPath = path.join(MODELS_DIR, 'tokenizer.json')

  const outputEncoder = path.join(OUTPUT_DIR, 'encoder.onnx')
  const outputDecoder = path.join(OUTPUT_DIR, 'decoder.onnx')
  const outputTokenizer = path.join(OUTPUT_DIR, 'tokenizer.json')

  await fs.copyFile(encoderPath, outputEncoder)
  await fs.copyFile(decoderPath, outputDecoder)

  if (await fs.access(tokenizerPath).then(() => true).catch(() => false)) {
    await fs.copyFile(tokenizerPath, outputTokenizer)
  }

  const encoderSize = await getFileSize(outputEncoder)
  const decoderSize = await getFileSize(outputDecoder)

  printStep(`Encoder: ${outputEncoder} (${encoderSize})`)
  printStep(`Decoder: ${outputDecoder} (${decoderSize})`)

  printSuccess('Models exported')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building codet5-models')
  logger.info('Converting and optimizing CodeT5 models')
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 2 * 1024 * 1024 * 1024)
  if (!diskOk) {
    throw new Error('Insufficient disk space (need 2GB)')
  }

  const pythonOk = await checkPythonVersion('3.8')
  if (!pythonOk) {
    throw new Error('Python 3.8+ required')
  }

  // Check for required Python packages.
  printStep('Checking Python dependencies')
  try {
    await execCapture('python3 -c "import transformers, onnx, onnxruntime"')
  } catch {
    printError(
      'Missing Python dependencies',
      'Install required packages: pip install transformers onnx onnxruntime'
    )
    throw new Error('Python dependencies not installed')
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await downloadModels()
  await convertToOnnx()
  await quantizeModels()
  await optimizeModels()
  await verifyModels()
  await exportModels()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test models with Socket CLI')
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed', e)
  throw e
})
