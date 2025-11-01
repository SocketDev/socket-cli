/**
 * Progressive enhancement NLP API.
 *
 * Baseline: compromise (pure JS, lightweight, always available)
 * Enhanced: MiniLM-L6 + ONNX Runtime (semantic embeddings, better accuracy)
 *
 * Gracefully falls back to compromise if models unavailable.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-node'

import { loadOnnxRuntime, stubOnnxRuntime } from './onnx-runtime-stub.mts'

// Lazy imports to avoid loading models unless needed.
let compromise: any = null
let onnxRuntime: typeof stubOnnxRuntime | null = null
let minilmSession: InferenceSession | null = null
let minilmTokenizer: any = null
let codet5EncoderSession: InferenceSession | null = null
let codet5DecoderSession: InferenceSession | null = null
let codet5Tokenizer: any = null

/**
 * Check if enhanced NLP (MiniLM + ONNX) is available.
 */
let enhancedAvailable: boolean | null = null
let codet5Available: boolean | null = null

/**
 * Model paths - can be configured via environment or embedded in binary.
 */
const getModelPaths = () => {
  // Check for embedded models first (bundled in CLI).
  const embeddedBase = process.env.SOCKET_MODELS_PATH || '.cache/models'

  return {
    minilmModel: `${embeddedBase}/minilm-l6-int4.onnx`,
    minilmTokenizer: `${embeddedBase}/minilm-l6-tokenizer.json`,
    codet5Encoder: `${embeddedBase}/codet5-encoder-int4.onnx`,
    codet5Decoder: `${embeddedBase}/codet5-decoder-int4.onnx`,
    codet5Tokenizer: `${embeddedBase}/codet5-tokenizer.json`,
  }
}

async function checkEnhancedNLP(): Promise<boolean> {
  if (enhancedAvailable !== null) {
    return enhancedAvailable
  }

  try {
    // Load ONNX Runtime (real or stub).
    onnxRuntime = await loadOnnxRuntime()

    if (!onnxRuntime) {
      enhancedAvailable = false
      return false
    }

    // Check if MiniLM model is available.
    const { minilmModel, minilmTokenizer: tokenizerPath } = getModelPaths()

    const { existsSync } = await import('node:fs')
    if (!existsSync(minilmModel) || !existsSync(tokenizerPath)) {
      enhancedAvailable = false
      return false
    }

    // Try to load the model.
    minilmSession = await onnxRuntime.InferenceSession.create(minilmModel) as InferenceSession | null

    if (!minilmSession) {
      enhancedAvailable = false
      return false
    }

    // Load tokenizer.
    const { readFile } = await import('node:fs/promises')
    const tokenizerData = await readFile(tokenizerPath, 'utf-8')
    minilmTokenizer = JSON.parse(tokenizerData)

    enhancedAvailable = true
    return true
  } catch {
    enhancedAvailable = false
    return false
  }
}

/**
 * Get compromise instance (lazy load).
 */
async function getCompromise() {
  if (!compromise) {
    compromise = (await import('compromise')).default
  }
  return compromise
}

/**
 * Tokenize text (baseline: compromise, enhanced: MiniLM tokenizer).
 */
export async function tokenize(text: string): Promise<string[]> {
  const hasEnhanced = await checkEnhancedNLP()

  if (hasEnhanced && minilmTokenizer) {
    // Use MiniLM tokenizer (more accurate).
    return tokenizeWithMiniLM(text)
  }

  // Fallback: compromise tokenization.
  const nlp = await getCompromise()
  const doc = nlp(text)
  return doc.terms().out('array')
}

/**
 * Tokenize with MiniLM tokenizer.
 */
function tokenizeWithMiniLM(text: string): string[] {
  // MiniLM uses WordPiece tokenization.
  // This is a simplified implementation - actual tokenizer is more complex.
  const vocab = minilmTokenizer.model?.vocab || {}
  const tokens: string[] = []

  const words = text.toLowerCase().split(/\s+/)
  for (const word of words) {
    if (vocab[word]) {
      tokens.push(word)
    } else {
      // Fallback: split into characters if word not in vocab.
      tokens.push(...word.split(''))
    }
  }

  return tokens
}

/**
 * Get semantic embedding for text (enhanced only).
 *
 * Returns null if enhanced NLP unavailable.
 */
export async function getEmbedding(text: string): Promise<Float32Array | null> {
  const hasEnhanced = await checkEnhancedNLP()

  if (!hasEnhanced || !minilmSession || !onnxRuntime) {
    return null
  }

  try {
    // Tokenize text.
    const tokens = tokenizeWithMiniLM(text)

    // Convert tokens to input IDs (simplified - real tokenizer is more complex).
    const vocab = minilmTokenizer.model?.vocab || {}
    const inputIds = tokens.map(token => vocab[token] || 0)

    // Pad/truncate to max length (MiniLM max: 128 tokens).
    const maxLength = 128
    while (inputIds.length < maxLength) {
      inputIds.push(0)
    }
    if (inputIds.length > maxLength) {
      inputIds.length = maxLength
    }

    // Create ONNX tensor.
    const inputTensor = new onnxRuntime.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, maxLength])

    // Run inference.
    const feeds = { input_ids: inputTensor }
    const results = await minilmSession.run(feeds)

    // Extract embeddings (last hidden state, [CLS] token).
    const output = results.last_hidden_state
    if (!output) {
      return null
    }

    // Get [CLS] embedding (first token).
    const embeddings = output.data as Float32Array
    const embeddingSize = 384 // MiniLM-L6 embedding dimension
    return embeddings.slice(0, embeddingSize)
  } catch {
    return null
  }
}

/**
 * Calculate cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Calculate semantic similarity between two texts.
 *
 * Enhanced: Uses MiniLM embeddings + cosine similarity.
 * Baseline: Uses compromise term overlap.
 */
export async function semanticSimilarity(text1: string, text2: string): Promise<number> {
  const hasEnhanced = await checkEnhancedNLP()

  if (hasEnhanced) {
    // Enhanced: MiniLM embeddings.
    const emb1 = await getEmbedding(text1)
    const emb2 = await getEmbedding(text2)

    if (emb1 && emb2) {
      return cosineSimilarity(emb1, emb2)
    }
  }

  // Fallback: compromise term overlap.
  const nlp = await getCompromise()
  const doc1 = nlp(text1)
  const doc2 = nlp(text2)

  const terms1 = new Set(doc1.terms().out('array'))
  const terms2 = new Set(doc2.terms().out('array'))

  const intersection = [...terms1].filter(t => terms2.has(t)).length
  const union = terms1.size + terms2.size - intersection

  return union > 0 ? intersection / union : 0
}

/**
 * Extract named entities from text.
 */
export async function extractEntities(text: string): Promise<{
  people: string[]
  places: string[]
  organizations: string[]
}> {
  const nlp = await getCompromise()
  const doc = nlp(text)

  return {
    people: doc.people().out('array'),
    places: doc.places().out('array'),
    organizations: doc.organizations().out('array'),
  }
}

/**
 * Get sentiment of text.
 */
export async function getSentiment(text: string): Promise<{
  score: number // -1 to 1
  label: 'negative' | 'neutral' | 'positive'
}> {
  const nlp = await getCompromise()
  const doc = nlp(text)

  // compromise has basic sentiment detection.
  const isPositive = doc.match('#Positive').found
  const isNegative = doc.match('#Negative').found

  let score = 0
  if (isPositive && !isNegative) {
    score = 0.5
  } else if (isNegative && !isPositive) {
    score = -0.5
  }

  const label = score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral'

  return { score, label }
}

/**
 * Normalize text (lowercase, remove punctuation, trim).
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if CodeT5 (code analysis) is available.
 */
async function checkCodeT5(): Promise<boolean> {
  if (codet5Available !== null) {
    return codet5Available
  }

  try {
    // Load ONNX Runtime (real or stub) if not already loaded.
    if (!onnxRuntime) {
      onnxRuntime = await loadOnnxRuntime()
    }

    if (!onnxRuntime) {
      codet5Available = false
      return false
    }

    // Check if CodeT5 models are available.
    const { codet5Encoder: encoderPath, codet5Decoder: decoderPath, codet5Tokenizer: tokenizerPath } = getModelPaths()

    const { existsSync } = await import('node:fs')
    if (!existsSync(encoderPath) || !existsSync(decoderPath) || !existsSync(tokenizerPath)) {
      codet5Available = false
      return false
    }

    // Try to load the models.
    codet5EncoderSession = await onnxRuntime.InferenceSession.create(encoderPath) as InferenceSession | null
    codet5DecoderSession = await onnxRuntime.InferenceSession.create(decoderPath) as InferenceSession | null

    if (!codet5EncoderSession || !codet5DecoderSession) {
      codet5Available = false
      return false
    }

    // Load tokenizer.
    const { readFile } = await import('node:fs/promises')
    const tokenizerData = await readFile(tokenizerPath, 'utf-8')
    codet5Tokenizer = JSON.parse(tokenizerData)

    codet5Available = true
    return true
  } catch {
    codet5Available = false
    return false
  }
}

/**
 * Analyze code structure and extract features (CodeT5 encoder).
 *
 * Enhanced: Uses CodeT5 encoder for deep code understanding.
 * Baseline: Uses basic heuristics.
 */
export async function analyzeCode(code: string, language?: string): Promise<{
  summary: string
  complexity: 'low' | 'medium' | 'high'
  features?: Float32Array // CodeT5 code embedding
  suggestions: string[]
}> {
  const hasCodeT5 = await checkCodeT5()

  if (hasCodeT5 && codet5EncoderSession && onnxRuntime) {
    // Enhanced: Use CodeT5 encoder for analysis.
    const features = await analyzeCodeWithEncoder(code)

    return {
      summary: `Analyzed with CodeT5 encoder (${language || 'code'})`,
      complexity: estimateComplexity(code),
      features, // Code embedding for similarity/classification
      suggestions: [], // TODO: Extract patterns from features
    }
  }

  // Fallback: Basic compromise-based analysis.
  const nlp = await getCompromise()
  const doc = nlp(code)

  const lines = code.split('\n').length
  const complexity = lines < 20 ? 'low' : lines < 100 ? 'medium' : 'high'

  return {
    summary: `${language || 'Code'} snippet with ${lines} lines`,
    complexity,
    suggestions: [],
  }
}

/**
 * Analyze code with CodeT5 encoder (produces code embedding).
 */
async function analyzeCodeWithEncoder(code: string): Promise<Float32Array | undefined> {
  if (!codet5EncoderSession || !codet5Tokenizer || !onnxRuntime) {
    return undefined
  }

  try {
    // Tokenize code.
    const vocab = codet5Tokenizer.model?.vocab || {}
    const tokens = code.toLowerCase().split(/\s+/)
    const inputIds = tokens.map(token => vocab[token] || 0)

    // Pad/truncate to max length (CodeT5 max: 512 tokens).
    const maxLength = 512
    while (inputIds.length < maxLength) {
      inputIds.push(0)
    }
    if (inputIds.length > maxLength) {
      inputIds.length = maxLength
    }

    // Create ONNX tensor.
    const inputTensor = new onnxRuntime.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, maxLength])

    // Run encoder.
    const encoderFeeds = { input_ids: inputTensor }
    const encoderResults = await codet5EncoderSession.run(encoderFeeds)

    // Extract hidden states (code embedding).
    const lastHiddenState = encoderResults.last_hidden_state
    if (!lastHiddenState) {
      return undefined
    }

    // Get [CLS] token embedding (first token represents entire code).
    const embeddings = lastHiddenState.data as Float32Array
    const embeddingSize = 768 // CodeT5 hidden size
    return embeddings.slice(0, embeddingSize)
  } catch {
    return undefined
  }
}

/**
 * Synthesize text from code analysis (CodeT5 decoder).
 *
 * Takes code + prompt, generates natural language output.
 * Uses encoder-decoder architecture.
 */
async function synthesizeFromCode(code: string, prompt: string): Promise<string | null> {
  if (!codet5EncoderSession || !codet5DecoderSession || !codet5Tokenizer || !onnxRuntime) {
    return null
  }

  try {
    // Tokenize code + prompt.
    const vocab = codet5Tokenizer.model?.vocab || {}
    const input = `${prompt}\n${code}`
    const tokens = input.toLowerCase().split(/\s+/)
    const inputIds = tokens.map(token => vocab[token] || 0)

    // Pad/truncate to max length (CodeT5 max: 512 tokens).
    const maxLength = 512
    while (inputIds.length < maxLength) {
      inputIds.push(0)
    }
    if (inputIds.length > maxLength) {
      inputIds.length = maxLength
    }

    // Create ONNX tensor.
    const inputTensor = new onnxRuntime.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, maxLength])

    // Run encoder (analyze).
    const encoderFeeds = { input_ids: inputTensor }
    const encoderResults = await codet5EncoderSession.run(encoderFeeds)

    // Run decoder (synthesize).
    // Simplified - full decoder requires:
    // 1. Start with [BOS] token
    // 2. Auto-regressive generation (feed output back as input)
    // 3. Beam search for better quality
    // 4. Stop at [EOS] token
    const decoderFeeds = {
      input_ids: inputTensor,
      encoder_hidden_states: encoderResults.last_hidden_state,
    }
    const decoderResults = await codet5DecoderSession.run(decoderFeeds)

    // Decode output tokens to text.
    // TODO: Implement proper token-to-text decoding with vocabulary.
    return '[CodeT5 synthesis - full implementation pending]'
  } catch {
    return null
  }
}

/**
 * Generate code summary using CodeT5 encoder-decoder.
 */
async function generateCodeSummary(code: string): Promise<string | null> {
  return await synthesizeFromCode(code, 'Summarize this code:')
}

/**
 * Explain vulnerability using CodeT5 (analyze + synthesize) or basic text (baseline).
 *
 * Analyze: CodeT5 encoder understands the vulnerable code.
 * Synthesize: CodeT5 decoder generates human-readable explanation.
 */
export async function explainVulnerability(
  vulnerabilityType: string,
  code?: string
): Promise<string> {
  const hasCodeT5 = await checkCodeT5()

  if (hasCodeT5 && code) {
    // Enhanced: Use CodeT5 encoder-decoder for context-aware explanation.
    const prompt = `Explain the ${vulnerabilityType} vulnerability:`
    const explanation = await synthesizeFromCode(code, prompt)

    if (explanation) {
      return explanation
    }
  }

  // Fallback: Generic explanation.
  return `${vulnerabilityType} vulnerability detected. Review the code for security issues.`
}

/**
 * Suggest fix for vulnerable code (analyze + synthesize).
 *
 * Analyze: Understand the vulnerability.
 * Synthesize: Generate fixed code.
 */
export async function suggestFix(
  vulnerableCode: string,
  vulnerabilityType: string
): Promise<string | null> {
  const hasCodeT5 = await checkCodeT5()

  if (!hasCodeT5) {
    return null
  }

  const prompt = `Fix the ${vulnerabilityType} vulnerability:`
  return await synthesizeFromCode(vulnerableCode, prompt)
}

/**
 * Synthesize code from natural language description (CodeT5 decoder).
 *
 * This is pure synthesis - no input code, generates from scratch.
 */
export async function synthesizeCode(
  description: string,
  language: string = 'javascript'
): Promise<string | null> {
  const hasCodeT5 = await checkCodeT5()

  if (!hasCodeT5) {
    return null // Only available with CodeT5
  }

  // For code generation, we use decoder with empty code input.
  const prompt = `Generate ${language} code: ${description}`
  return await synthesizeFromCode('', prompt)
}

/**
 * Calculate similarity between two code snippets (analyze).
 */
export async function calculateCodeSimilarity(
  code1: string,
  code2: string
): Promise<number> {
  const hasCodeT5 = await checkCodeT5()

  if (hasCodeT5) {
    // Enhanced: Use CodeT5 encoder embeddings.
    const features1 = await analyzeCodeWithEncoder(code1)
    const features2 = await analyzeCodeWithEncoder(code2)

    if (features1 && features2) {
      return cosineSimilarity(features1, features2)
    }
  }

  // Fallback: Use semantic similarity (compromise).
  return await semanticSimilarity(code1, code2)
}

/**
 * Estimate code complexity (baseline heuristic).
 */
function estimateComplexity(code: string): 'low' | 'medium' | 'high' {
  const lines = code.split('\n').length
  const cyclomaticIndicators = (code.match(/\b(if|else|for|while|switch|case|\?\?|\|\|)\b/g) || []).length

  if (lines < 20 && cyclomaticIndicators < 5) return 'low'
  if (lines < 100 && cyclomaticIndicators < 15) return 'medium'
  return 'high'
}

/**
 * Check if enhanced NLP is available.
 */
export async function isEnhancedNLP(): Promise<boolean> {
  return await checkEnhancedNLP()
}

/**
 * Check if CodeT5 is available.
 */
export async function isCodeT5Available(): Promise<boolean> {
  return await checkCodeT5()
}

/**
 * Get NLP capabilities available.
 */
export async function getNLPCapabilities(): Promise<{
  baseline: boolean
  enhanced: boolean
  codet5: boolean
  features: {
    // Text NLP (compromise + MiniLM)
    tokenization: boolean
    embeddings: boolean
    semanticSimilarity: boolean
    namedEntities: boolean
    sentiment: boolean
    // Code NLP (CodeT5)
    codeAnalysis: boolean           // Encoder: understand code structure
    codeSynthesis: boolean          // Decoder: generate code/explanations
    codeSimilarity: boolean         // Encoder: compare code semantically
    vulnerabilityExplanation: boolean // Encoder + Decoder
    vulnerabilityFixes: boolean     // Encoder + Decoder
  }
}> {
  const hasEnhanced = await checkEnhancedNLP()
  const hasCodeT5 = await checkCodeT5()

  return {
    baseline: true, // compromise always available
    enhanced: hasEnhanced, // MiniLM + ONNX Runtime
    codet5: hasCodeT5, // CodeT5 encoder + decoder + ONNX Runtime
    features: {
      // Text NLP
      tokenization: true,
      embeddings: hasEnhanced, // MiniLM embeddings
      semanticSimilarity: true, // Both baseline and enhanced
      namedEntities: true, // compromise only
      sentiment: true, // compromise only

      // Code NLP (CodeT5)
      codeAnalysis: true, // Both baseline (heuristics) and CodeT5 (encoder)
      codeSynthesis: hasCodeT5, // CodeT5 decoder only
      codeSimilarity: true, // Both baseline and CodeT5
      vulnerabilityExplanation: true, // Both baseline and CodeT5
      vulnerabilityFixes: hasCodeT5, // CodeT5 encoder+decoder only
    },
  }
}
