/**
 * MiniLM Semantic Inference Engine
 *
 * WHAT THIS IS:
 * Direct ONNX Runtime integration for semantic text understanding.
 * No transformers.js wrapper - we control the entire stack.
 *
 * THE STACK:
 * ┌─────────────────────────────────────┐
 * │ Text Query                          │
 * ├─────────────────────────────────────┤
 * │ WordPiece Tokenizer (pure JS)      │  ← We own
 * ├─────────────────────────────────────┤
 * │ ONNX Runtime (WASM)                 │  ← We control
 * ├─────────────────────────────────────┤
 * │ MiniLM Model (embedded)             │  ← We bundle
 * ├─────────────────────────────────────┤
 * │ Embedding Vector (384 dims)        │  ← Output
 * └─────────────────────────────────────┘
 *
 * WHY DIRECT ONNX:
 * - Full control over WASM loading
 * - Synchronous initialization possible
 * - No black-box auto-selection
 * - Explicit error handling
 * - SEA-compatible architecture
 *
 * PERFORMANCE:
 * - First load: ~200-300ms (model initialization)
 * - Subsequent: ~50-80ms per query
 * - Embedding dim: 384 floats
 * - Model size: ~17MB (quantized)
 *
 * USAGE:
 * ```typescript
 * import { MiniLMInference } from './minilm-inference.mts'
 *
 * // Initialize (once).
 * const model = await MiniLMInference.create()
 *
 * // Get embeddings.
 * const embedding = await model.embed('fix vulnerabilities')
 * console.log(embedding) // Float32Array(384)
 *
 * // Compute similarity.
 * const sim = model.cosineSimilarity(embedding1, embedding2)
 * console.log(sim) // 0.0 to 1.0
 * ```
 */

import { WordPieceTokenizer } from './wordpiece-tokenizer.mts'

import type { Vocabulary } from './wordpiece-tokenizer.mts'
import type { InferenceSession } from 'onnxruntime-web'

/**
 * MiniLM inference result.
 */
export interface EmbeddingResult {
  /** Embedding vector (384 dimensions). */
  embedding: Float32Array

  /** Token IDs that were processed. */
  tokenIds: number[]

  /** Number of tokens processed. */
  tokenCount: number

  /** Inference time in milliseconds. */
  inferenceMs: number
}

/**
 * MiniLM Semantic Inference Engine.
 *
 * Provides text → embedding conversion using ONNX Runtime + MiniLM model.
 */
export class MiniLMInference {
  private session: InferenceSession
  private tokenizer: WordPieceTokenizer
  private embeddingDim = 384

  private constructor(
    session: InferenceSession,
    tokenizer: WordPieceTokenizer,
  ) {
    this.session = session
    this.tokenizer = tokenizer
  }

  /**
   * Create MiniLM inference engine.
   *
   * INITIALIZATION PROCESS:
   * 1. Load ONNX Runtime WASM (from external/onnx-sync.mjs)
   * 2. Load MiniLM model (from external/minilm-sync.mjs)
   * 3. Load tokenizer vocabulary
   * 4. Create ONNX inference session
   * 5. Initialize tokenizer
   *
   * @returns Initialized inference engine
   */
  static async create(): Promise<MiniLMInference> {
    // Step 1: Import ONNX Runtime with embedded WASM.
    // This loads from external/onnx-sync.mjs which has the WASM inlined.
    // @ts-expect-error - No type declarations for external ONNX bundle.
    const ort = await import('../../external/onnx-sync.mjs')

    // Step 2: Load embedded model and tokenizer.
    const {
      loadModelSync,
      loadTokenizerSync,
      // @ts-expect-error - No type declarations for external MiniLM bundle.
    } = await import('../../external/minilm-sync.mjs')

    const modelBytes = loadModelSync()
    const tokenizerConfig = loadTokenizerSync()

    // Step 3: Create ONNX inference session.
    const session = await ort.InferenceSession.create(modelBytes.buffer)

    // Step 4: Extract vocabulary from tokenizer config.
    const vocab: Vocabulary = tokenizerConfig.model.vocab

    // Step 5: Initialize WordPiece tokenizer.
    const tokenizer = new WordPieceTokenizer({
      vocab,
      doLowerCase: tokenizerConfig.normalizer?.lowercase ?? true,
      maxLength: 512,
    })

    return new MiniLMInference(session, tokenizer)
  }

  /**
   * Generate embedding for text.
   *
   * PROCESS:
   * 1. Tokenize text (WordPiece)
   * 2. Create ONNX input tensors
   * 3. Run inference
   * 4. Extract last_hidden_state
   * 5. Apply mean pooling
   * 6. Normalize to unit vector
   *
   * @param text - Input text
   * @returns Embedding result with vector and metadata
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const startTime = performance.now()

    // Step 1: Tokenize.
    const tokenization = this.tokenizer.tokenize(text)

    // Step 2: Create input tensors.
    // @ts-expect-error - No type declarations for external ONNX bundle.
    const { Tensor } = await import('../../external/onnx-sync.mjs')

    const inputIds = new Tensor(
      'int64',
      BigInt64Array.from(tokenization.inputIds.map(BigInt)),
      [1, tokenization.inputIds.length],
    )

    const attentionMask = new Tensor(
      'int64',
      BigInt64Array.from(tokenization.attentionMask.map(BigInt)),
      [1, tokenization.attentionMask.length],
    )

    // Step 3: Run ONNX inference.
    const outputs = await this.session.run({
      input_ids: inputIds,
      attention_mask: attentionMask,
    })

    // Step 4: Extract last_hidden_state tensor.
    const lastHiddenState = outputs['last_hidden_state']

    if (!lastHiddenState) {
      throw new Error('Model did not return last_hidden_state')
    }

    // Step 5: Apply mean pooling.
    const pooled = this.meanPooling(
      lastHiddenState.data as Float32Array,
      tokenization.attentionMask,
      this.embeddingDim,
    )

    // Step 6: Normalize to unit vector.
    const normalized = this.normalize(pooled)

    const inferenceMs = performance.now() - startTime

    return {
      embedding: normalized,
      tokenIds: tokenization.inputIds,
      tokenCount: tokenization.tokens.length,
      inferenceMs,
    }
  }

  /**
   * Mean pooling over token embeddings.
   *
   * WHAT IT DOES:
   * Takes all token embeddings and averages them (weighted by attention mask).
   * This creates a single fixed-size vector representing the entire input.
   *
   * EXAMPLE:
   * Input tokens:  [CLS] fix vulnerabilities [SEP]
   * Token embeddings: 4 x 384 matrix
   * Output: 1 x 384 vector (averaged)
   *
   * @param embeddings - Flattened embedding matrix [seqLen * embeddingDim]
   * @param attentionMask - Attention mask [seqLen]
   * @param embeddingDim - Embedding dimension (384)
   * @returns Pooled embedding [embeddingDim]
   */
  private meanPooling(
    embeddings: Float32Array,
    attentionMask: number[],
    embeddingDim: number,
  ): Float32Array {
    const seqLen = attentionMask.length
    const pooled = new Float32Array(embeddingDim)
    let totalMask = 0

    // Sum embeddings weighted by attention mask.
    for (let i = 0; i < seqLen; i++) {
      const mask = attentionMask[i] ?? 0
      totalMask += mask

      for (let j = 0; j < embeddingDim; j++) {
        const embeddingValue = embeddings[i * embeddingDim + j] ?? 0
        pooled[j] = (pooled[j] ?? 0) + embeddingValue * mask
      }
    }

    // Average.
    for (let j = 0; j < embeddingDim; j++) {
      pooled[j] = (pooled[j] ?? 0) / totalMask
    }

    return pooled
  }

  /**
   * Normalize vector to unit length.
   *
   * WHAT IT DOES:
   * Scales vector so its magnitude is exactly 1.0.
   * This allows cosine similarity to be computed as simple dot product.
   *
   * FORMULA:
   * normalized[i] = vector[i] / ||vector||
   * where ||vector|| = sqrt(sum(vector[i]^2))
   *
   * @param vector - Input vector
   * @returns Normalized vector (unit length)
   */
  private normalize(vector: Float32Array): Float32Array {
    // Compute magnitude.
    let magnitude = 0
    for (let i = 0; i < vector.length; i++) {
      const val = vector[i] ?? 0
      magnitude += val * val
    }
    magnitude = Math.sqrt(magnitude)

    // Normalize.
    const normalized = new Float32Array(vector.length)
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = (vector[i] ?? 0) / magnitude
    }

    return normalized
  }

  /**
   * Compute cosine similarity between two embeddings.
   *
   * WHAT IT IS:
   * Measures how similar two vectors are (0.0 to 1.0).
   * - 1.0 = identical meaning
   * - 0.0 = completely different
   *
   * FORMULA (for normalized vectors):
   * similarity = dot(a, b) = sum(a[i] * b[i])
   *
   * @param a - First embedding (normalized)
   * @param b - Second embedding (normalized)
   * @returns Similarity score (0.0 to 1.0)
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimension')
    }

    // Since vectors are normalized, cosine similarity = dot product.
    let dotProduct = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += (a[i] ?? 0) * (b[i] ?? 0)
    }

    return dotProduct
  }

  /**
   * Batch embed multiple texts.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding results
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = []

    for (const text of texts) {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.embed(text)
      results.push(result)
    }

    return results
  }
}
