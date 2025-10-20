/**
 * Pre-compute semantic embeddings WITHOUT transformers.js wrapper.
 * Uses ONNX Runtime directly - no sharp, no image processing dependencies.
 */

import { promises as fs, mkdirSync, readFileSync, writeFileSync  } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// eslint-disable-next-line import-x/no-unresolved, n/no-missing-import
import * as ort from 'onnxruntime-node'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.join(path.dirname(__dirname), '../.claude/skills/socket-cli')
const cacheDir = path.join(path.dirname(__dirname), '.cache/models')

console.log('🧠 Computing semantic embeddings (pure ONNX, no transformers.js)...')

// Ensure cache directory exists.
mkdirSync(cacheDir, { recursive: true })

// Download model if not cached.
const modelPath = path.join(cacheDir, 'paraphrase-MiniLM-L3-v2.onnx')

async function downloadModel() {
  try {
    await fs.access(modelPath)
    console.log('✓ Model already cached')
    return
  } catch {
    console.log('📦 Downloading paraphrase-MiniLM-L3-v2 model...')

    // Hugging Face model URL (quantized ONNX).
    const modelUrl = 'https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/resolve/main/onnx/model_quantized.onnx'

    const response = await fetch(modelUrl)
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    await fs.writeFile(modelPath, Buffer.from(buffer))

    console.log(`✓ Downloaded ${buffer.byteLength} bytes`)
  }
}

// Download tokenizer config.
const tokenizerPath = path.join(cacheDir, 'tokenizer.json')

async function downloadTokenizer() {
  try {
    await fs.access(tokenizerPath)
    console.log('✓ Tokenizer already cached')
    return
  } catch {
    console.log('📦 Downloading tokenizer...')

    const tokenizerUrl = 'https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/resolve/main/tokenizer.json'

    const response = await fetch(tokenizerUrl)
    if (!response.ok) {
      throw new Error(`Failed to download tokenizer: ${response.statusText}`)
    }

    const json = await response.json()
    await fs.writeFile(tokenizerPath, JSON.stringify(json, null, 2))

    console.log('✓ Downloaded tokenizer')
  }
}

/**
 * Simple tokenizer for BERT-like models.
 */
class SimpleTokenizer {
  constructor(vocab) {
    this.vocab = vocab
    this.idsToTokens = Object.fromEntries(
      Object.entries(vocab).map(([k, v]) => [v, k])
    )
  }

  encode(text) {
    // Simple whitespace + lowercase tokenization.
    // Real implementation would use WordPiece.
    const tokens = ['[CLS]']

    for (const word of text.toLowerCase().split(/\s+/)) {
      if (this.vocab[word] !== undefined) {
        tokens.push(word)
      } else {
        // Split into subwords (simplified).
        tokens.push('[UNK]')
      }
    }

    tokens.push('[SEP]')

    return {
      input_ids: tokens.map(t => this.vocab[t] ?? this.vocab['[UNK]']),
      attention_mask: tokens.map(() => 1),
    }
  }
}

/**
 * Mean pooling over token embeddings.
 */
function meanPooling(embeddings, attentionMask) {
  const seqLen = embeddings.length
  const hiddenSize = embeddings[0].length

  const pooled = new Array(hiddenSize).fill(0)
  let totalMask = 0

  for (let i = 0; i < seqLen; i++) {
    const mask = attentionMask[i]
    totalMask += mask

    for (let j = 0; j < hiddenSize; j++) {
      pooled[j] += embeddings[i][j] * mask
    }
  }

  // Average.
  for (let j = 0; j < hiddenSize; j++) {
    pooled[j] /= totalMask
  }

  return pooled
}

/**
 * Normalize vector to unit length.
 */
function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return vector.map(v => v / norm)
}

/**
 * Get embedding for text using ONNX Runtime.
 */
async function getEmbedding(session, tokenizer, text) {
  // Tokenize.
  const { attention_mask, input_ids } = tokenizer.encode(text)

  // Create tensors.
  const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(input_ids.map(BigInt)), [1, input_ids.length])
  const attentionMaskTensor = new ort.Tensor('int64', BigInt64Array.from(attention_mask.map(BigInt)), [1, attention_mask.length])

  // Run inference.
  const outputs = await session.run({
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor,
  })

  // Get embeddings (last_hidden_state).
  const embeddings = outputs.last_hidden_state.data
  const seqLen = input_ids.length
  const hiddenSize = embeddings.length / seqLen

  // Reshape to [seqLen, hiddenSize].
  const embeddingsArray = []
  for (let i = 0; i < seqLen; i++) {
    embeddingsArray.push(
      Array.from(embeddings.slice(i * hiddenSize, (i + 1) * hiddenSize))
    )
  }

  // Mean pooling.
  const pooled = meanPooling(embeddingsArray, attention_mask)

  // Normalize.
  return normalize(pooled)
}

// Main execution.
await downloadModel()
await downloadTokenizer()

console.log('📝 Loading model...')
const session = await ort.InferenceSession.create(modelPath)

console.log('📝 Loading tokenizer...')
const tokenizerData = JSON.parse(readFileSync(tokenizerPath, 'utf-8'))
const tokenizer = new SimpleTokenizer(tokenizerData.model.vocab)

console.log('📝 Loading commands...')
const commandsPath = path.join(skillDir, 'commands.json')
const commands = JSON.parse(readFileSync(commandsPath, 'utf-8'))

// Compute embeddings.
const embeddings = {
  commands: {},
  examples: {},
  meta: {
    model: 'Xenova/paraphrase-MiniLM-L3-v2',
    dimension: 384,
    generatedAt: new Date().toISOString(),
    method: 'pure-onnx',
  },
}

console.log('🔢 Computing command embeddings...')
for (const [commandName, commandData] of Object.entries(commands.commands)) {
  console.log(`  → ${commandName}`)

  const embedding = await getEmbedding(session, tokenizer, commandData.description)

  embeddings.commands[commandName] = {
    description: commandData.description,
    embedding,
    keywords: commandData.keywords,
    examples: commandData.examples,
  }
}

console.log('🔢 Computing example embeddings...')
for (const [commandName, commandData] of Object.entries(commands.commands)) {
  for (const example of commandData.examples) {
    const embedding = await getEmbedding(session, tokenizer, example)
    embeddings.examples[example] = {
      command: commandName,
      embedding,
    }
  }
}

// Save embeddings.
const outputPath = path.join(skillDir, 'embeddings.json')
writeFileSync(outputPath, JSON.stringify(embeddings, null, 2), 'utf-8')

console.log(`\n✓ Generated ${outputPath}`)
console.log(`✓ Embedded ${Object.keys(embeddings.commands).length} commands`)
console.log(`✓ Embedded ${Object.keys(embeddings.examples).length} example queries`)
console.log(`✓ File size: ${(JSON.stringify(embeddings).length / 1024).toFixed(2)} KB`)
