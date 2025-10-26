#!/usr/bin/env node
/**
 * MiniLM Model Builder
 *
 * Converts and optimizes MiniLM models for Socket CLI:
 * 1. Download models from Hugging Face
 * 2. Convert to ONNX format
 * 3. Apply INT4/INT8 mixed-precision quantization
 * 4. Optimize ONNX graphs
 * 5. Verify inference
 * 6. Export to distribution location
 *
 * Usage:
 *   node scripts/build.mjs          # Normal build with checkpoints
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'

import { exec } from '@socketsecurity/build-infra/lib/build-exec'
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
  printWarning,
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
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build')
const MODELS_DIR = path.join(BUILD_DIR, 'models')
const CACHE_DIR = path.join(BUILD_DIR, 'cache')
const PYTHON_DIR = path.join(ROOT_DIR, 'python')

// Model configuration.
const MODELS = [
  {
    name: 'sentence-transformers/all-MiniLM-L6-v2',
    outputName: 'minilm',
    hiddenSize: 384,
    numHeads: 12,
  },
]

/**
 * Ensure Python scripts directory exists and create helper scripts.
 */
async function setupPythonScripts() {
  await fs.mkdir(PYTHON_DIR, { recursive: true })

  // Create download script.
  const downloadScript = `#!/usr/bin/env python3
"""Download MiniLM models from Hugging Face."""
import sys
import json
from pathlib import Path

try:
    from transformers import AutoModel, AutoTokenizer
except ImportError:
    print(json.dumps({"error": "transformers not installed"}))
    sys.exit(1)

model_name = sys.argv[1]
cache_dir = sys.argv[2]

try:
    print(json.dumps({"status": "downloading_model"}))
    model = AutoModel.from_pretrained(model_name)

    print(json.dumps({"status": "downloading_tokenizer"}))
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    cache_path = Path(cache_dir)
    cache_path.mkdir(parents=True, exist_ok=True)

    print(json.dumps({"status": "saving_model"}))
    model.save_pretrained(cache_path)

    print(json.dumps({"status": "saving_tokenizer"}))
    tokenizer.save_pretrained(cache_path)

    print(json.dumps({"status": "complete", "cache_dir": str(cache_path)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`

  // Create convert script.
  const convertScript = `#!/usr/bin/env python3
"""Convert PyTorch models to ONNX format."""
import sys
import json
from pathlib import Path

try:
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer
except ImportError:
    print(json.dumps({"error": "optimum[onnxruntime] not installed"}))
    sys.exit(1)

cache_dir = sys.argv[1]
output_dir = sys.argv[2]

try:
    print(json.dumps({"status": "loading_model"}))
    model = ORTModelForFeatureExtraction.from_pretrained(
        cache_dir,
        export=True,
        provider="CPUExecutionProvider"
    )

    print(json.dumps({"status": "loading_tokenizer"}))
    tokenizer = AutoTokenizer.from_pretrained(cache_dir)

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(json.dumps({"status": "saving_onnx"}))
    model.save_pretrained(output_path)
    tokenizer.save_pretrained(output_path)

    print(json.dumps({"status": "complete", "output_dir": str(output_path)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`

  // Create quantize script.
  const quantizeScript = `#!/usr/bin/env python3
"""Apply INT8 quantization to ONNX models."""
import sys
import json
from pathlib import Path

try:
    from optimum.onnxruntime import ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
except ImportError:
    print(json.dumps({"error": "optimum[onnxruntime] not installed"}))
    sys.exit(1)

model_dir = sys.argv[1]
output_dir = sys.argv[2]

try:
    print(json.dumps({"status": "loading_quantizer"}))
    quantizer = ORTQuantizer.from_pretrained(model_dir)

    print(json.dumps({"status": "configuring_quantization"}))
    qconfig = AutoQuantizationConfig.avx512_vnni(
        is_static=False,
        per_channel=True
    )

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(json.dumps({"status": "quantizing"}))
    quantizer.quantize(save_dir=output_path, quantization_config=qconfig)

    print(json.dumps({"status": "complete", "output_dir": str(output_path)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`

  // Create optimize script.
  const optimizeScript = `#!/usr/bin/env python3
"""Optimize ONNX graphs for inference."""
import sys
import json
from pathlib import Path

try:
    from onnxruntime.transformers.optimizer import optimize_model
except ImportError:
    print(json.dumps({"error": "onnxruntime not installed"}))
    sys.exit(1)

model_path = sys.argv[1]
output_path = sys.argv[2]
num_heads = int(sys.argv[3])
hidden_size = int(sys.argv[4])

try:
    print(json.dumps({"status": "loading_model"}))

    print(json.dumps({"status": "optimizing"}))
    optimized_model = optimize_model(
        input=model_path,
        model_type='bert',
        num_heads=num_heads,
        hidden_size=hidden_size,
        optimization_options={
            'enable_gelu_approximation': True,
            'enable_skip_layer_norm': True,
        }
    )

    print(json.dumps({"status": "saving"}))
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    optimized_model.save_model_to_file(output_path)

    print(json.dumps({"status": "complete", "output_path": output_path}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`

  // Create verify script.
  const verifyScript = `#!/usr/bin/env python3
"""Verify ONNX model inference."""
import sys
import json
import numpy as np

try:
    import onnxruntime
    from transformers import AutoTokenizer
except ImportError:
    print(json.dumps({"error": "onnxruntime or transformers not installed"}))
    sys.exit(1)

model_path = sys.argv[1]
tokenizer_path = sys.argv[2]
test_text = sys.argv[3] if len(sys.argv) > 3 else "This is a test"

try:
    print(json.dumps({"status": "loading_session"}))
    session = onnxruntime.InferenceSession(model_path)

    print(json.dumps({"status": "loading_tokenizer"}))
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)

    print(json.dumps({"status": "tokenizing"}))
    inputs = tokenizer(test_text, return_tensors="np", padding=True, truncation=True)

    print(json.dumps({"status": "running_inference"}))
    onnx_inputs = {k: v for k, v in inputs.items()}
    outputs = session.run(None, onnx_inputs)

    output_shape = outputs[0].shape
    output_mean = float(np.mean(outputs[0]))
    output_std = float(np.std(outputs[0]))

    print(json.dumps({
        "status": "complete",
        "test_text": test_text,
        "output_shape": list(output_shape),
        "output_mean": output_mean,
        "output_std": output_std
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`

  await fs.writeFile(path.join(PYTHON_DIR, 'download.py'), downloadScript)
  await fs.writeFile(path.join(PYTHON_DIR, 'convert.py'), convertScript)
  await fs.writeFile(path.join(PYTHON_DIR, 'quantize.py'), quantizeScript)
  await fs.writeFile(path.join(PYTHON_DIR, 'optimize.py'), optimizeScript)
  await fs.writeFile(path.join(PYTHON_DIR, 'verify.py'), verifyScript)
}

/**
 * Run Python script and parse JSON output.
 */
async function runPythonScript(scriptName, args, options = {}) {
  const scriptPath = path.join(PYTHON_DIR, scriptName)
  const command = `python3 "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`

  const { stdout } = await exec(command, {
    stdio: 'pipe',
    ...options
  })

  // Parse JSON output from Python script.
  const lines = stdout.split('\n').filter(Boolean)
  const results = []

  for (const line of lines) {
    try {
      const result = JSON.parse(line)
      results.push(result)

      if (result.error) {
        throw new Error(result.error)
      }

      if (result.status && result.status !== 'complete') {
        printStep(`  ${result.status.replace(/_/g, ' ')}...`)
      }
    } catch (e) {
      if (e.message.startsWith('{')) {
        continue
      }
      throw e
    }
  }

  return results[results.length - 1] || {}
}

/**
 * Download models from Hugging Face.
 */
async function downloadModels() {
  if (!(await shouldRun('minilm', 'downloaded', FORCE_BUILD))) {
    return
  }

  printHeader('Downloading Models from Hugging Face')

  await fs.mkdir(CACHE_DIR, { recursive: true })

  for (const model of MODELS) {
    printStep(`Model: ${model.name}`)

    try {
      const modelCache = path.join(CACHE_DIR, model.outputName)
      await runPythonScript('download.py', [model.name, modelCache])
      printSuccess(`Downloaded: ${model.name}`)
    } catch (e) {
      if (e.message.includes('transformers not installed')) {
        printWarning('Python transformers library not installed')
        printWarning('Install with: pip install transformers')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  printSuccess('Model download complete')
  await createCheckpoint('minilm', 'downloaded')
}

/**
 * Convert models to ONNX format.
 */
async function convertToOnnx() {
  if (!(await shouldRun('minilm', 'converted', FORCE_BUILD))) {
    return
  }

  printHeader('Converting Models to ONNX')

  await fs.mkdir(MODELS_DIR, { recursive: true })

  for (const model of MODELS) {
    printStep(`Converting: ${model.name}`)

    try {
      const modelCache = path.join(CACHE_DIR, model.outputName)
      const modelOutput = path.join(MODELS_DIR, `${model.outputName}-onnx`)

      await runPythonScript('convert.py', [modelCache, modelOutput])
      printSuccess(`Converted: ${model.name}`)
    } catch (e) {
      if (e.message.includes('optimum')) {
        printWarning('Python optimum library not installed')
        printWarning('Install with: pip install optimum[onnxruntime]')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  printSuccess('ONNX conversion complete')
  await createCheckpoint('minilm', 'converted')
}

/**
 * Apply mixed-precision quantization.
 */
async function quantizeModels() {
  if (!(await shouldRun('minilm', 'quantized', FORCE_BUILD))) {
    return
  }

  printHeader('Applying INT8 Quantization')

  for (const model of MODELS) {
    printStep(`Quantizing: ${model.outputName}`)

    try {
      const modelInput = path.join(MODELS_DIR, `${model.outputName}-onnx`)
      const modelOutput = path.join(MODELS_DIR, `${model.outputName}-quantized`)

      const sizeBefore = await getFileSize(path.join(modelInput, 'model.onnx'))
      printStep(`  Size before: ${sizeBefore}`)

      await runPythonScript('quantize.py', [modelInput, modelOutput])

      const sizeAfter = await getFileSize(path.join(modelOutput, 'model.onnx'))
      printStep(`  Size after: ${sizeAfter}`)

      printSuccess(`Quantized: ${model.outputName}`)
    } catch (e) {
      if (e.message.includes('optimum')) {
        printWarning('Python optimum library not installed')
        printWarning('Install with: pip install optimum[onnxruntime]')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  printSuccess('Quantization complete')
  await createCheckpoint('minilm', 'quantized')
}

/**
 * Optimize ONNX graphs.
 */
async function optimizeGraphs() {
  if (!(await shouldRun('minilm', 'optimized', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing ONNX Graphs')

  for (const model of MODELS) {
    printStep(`Optimizing: ${model.outputName}`)

    try {
      const modelInput = path.join(MODELS_DIR, `${model.outputName}-quantized`, 'model.onnx')
      const modelOutput = path.join(MODELS_DIR, `${model.outputName}.onnx`)

      await runPythonScript('optimize.py', [
        modelInput,
        modelOutput,
        String(model.numHeads),
        String(model.hiddenSize)
      ])

      const finalSize = await getFileSize(modelOutput)
      printStep(`  Final size: ${finalSize}`)

      printSuccess(`Optimized: ${model.outputName}`)
    } catch (e) {
      if (e.message.includes('onnxruntime not installed')) {
        printWarning('Python onnxruntime library not installed')
        printWarning('Install with: pip install onnxruntime')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  printSuccess('Graph optimization complete')
  await createCheckpoint('minilm', 'optimized')
}

/**
 * Verify models work correctly.
 */
async function verifyModels() {
  if (!(await shouldRun('minilm', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying Model Inference')

  for (const model of MODELS) {
    printStep(`Verifying: ${model.outputName}`)

    try {
      const modelPath = path.join(MODELS_DIR, `${model.outputName}.onnx`)
      const tokenizerPath = path.join(MODELS_DIR, `${model.outputName}-quantized`)
      const testText = 'This is a test'

      const result = await runPythonScript('verify.py', [
        modelPath,
        tokenizerPath,
        testText
      ])

      printStep(`  Test: "${result.test_text}"`)
      printStep(`  Output shape: [${result.output_shape.join(', ')}]`)
      printStep(`  Mean: ${result.output_mean.toFixed(4)}, Std: ${result.output_std.toFixed(4)}`)

      printSuccess(`Verified: ${model.outputName}`)
    } catch (e) {
      if (e.message.includes('not installed')) {
        printWarning('Missing Python dependencies')
        printWarning('Install with: pip install onnxruntime transformers')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  printSuccess('Model verification complete')
  await createCheckpoint('minilm', 'verified')
}

/**
 * Export models to distribution location.
 */
async function exportModels() {
  printHeader('Exporting Models')

  for (const model of MODELS) {
    printStep(`Exporting: ${model.outputName}`)

    const modelPath = path.join(MODELS_DIR, `${model.outputName}.onnx`)
    const tokenizerSrc = path.join(MODELS_DIR, `${model.outputName}-quantized`)
    const tokenizerDst = path.join(MODELS_DIR, `${model.outputName}-tokenizer`)

    // Check if models exist.
    const modelExists = await fs.access(modelPath).then(() => true).catch(() => false)

    if (!modelExists) {
      printWarning(`Model not found: ${modelPath}`)
      printWarning(`Run build to generate models`)
      continue
    }

    // Copy tokenizer files.
    await fs.mkdir(tokenizerDst, { recursive: true })

    const tokenizerFiles = ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt']
    for (const file of tokenizerFiles) {
      const src = path.join(tokenizerSrc, file)
      const dst = path.join(tokenizerDst, file)

      if (await fs.access(src).then(() => true).catch(() => false)) {
        await fs.copyFile(src, dst)
      }
    }

    const modelSize = await getFileSize(modelPath)
    printStep(`  Model: ${modelSize}`)
    printStep(`  Location: ${modelPath}`)
  }

  printSuccess('Export complete')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🤖 Building minilm models')
  logger.info('MiniLM model conversion and optimization')
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 1 * 1024 * 1024 * 1024)
  if (!diskOk) {
    printWarning('Could not check disk space')
  }

  const pythonOk = await checkPythonVersion('3.8')
  if (!pythonOk) {
    printError('Python 3.8+ required')
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error('Python 3.8+ required')
  }

  printSuccess('Pre-flight checks passed')

  // Setup Python scripts.
  await setupPythonScripts()

  // Build phases.
  await downloadModels()
  await convertToOnnx()
  await quantizeModels()
  await optimizeGraphs()
  await verifyModels()
  await exportModels()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${MODELS_DIR}`)
  logger.info('')
  logger.info('Models ready for use:')
  for (const model of MODELS) {
    logger.info(`  - ${model.outputName}.onnx`)
    logger.info(`  - ${model.outputName}-tokenizer/`)
  }
  logger.info('')
}

// Run build.
main().catch((e) => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
