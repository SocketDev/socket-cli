/**
 * ONNX-embedding-based command matching for `socket ask`.
 *
 * Extracted from handle-ask.mts to keep that file under the 1000-line cap. The
 * ONNX matcher is the slow path: it lazily loads a ~17MB MiniLM model
 * (currently disabled — see getEmbeddingPipeline body) and scores command
 * descriptions against the query using cosine similarity over the embedded
 * vectors. Used as a fallback when both pattern matching and word-overlap
 * matching score below their respective confidence thresholds.
 */

// Lazy-loaded ONNX embedding pipeline (~17MB model when enabled).
type EmbeddingPipeline = {
  embed(text: string): Promise<{ embedding: Float32Array }>
}
const embeddingPipeline: EmbeddingPipeline | undefined = undefined
let embeddingPipelineFailure = false
const commandEmbeddings: Record<string, Float32Array> = {}

/**
 * Compute cosine similarity between two vectors. Since our embeddings are
 * normalized, cosine similarity reduces to a dot product. Returns 0 when the
 * vectors have different lengths.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    return 0
  }
  let dotProduct = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return dotProduct
}

/**
 * Pre-compute embeddings for the canonical command descriptions. Idempotent:
 * skips work after the first successful pass. Reads through getEmbedding so a
 * disabled pipeline is a silent no-op.
 */
export async function ensureCommandEmbeddings(): Promise<void> {
  /* c8 ignore start -- defensive: commandEmbeddings only populates when the ONNX pipeline is enabled, which is currently disabled (see getEmbeddingPipeline). */
  if (Object.keys(commandEmbeddings).length > 0) {
    return
  }
  /* c8 ignore stop */

  const commandDescriptions = {
    __proto__: null,
    fix: 'fix vulnerabilities by updating packages to secure versions',
    patch: 'apply patches to remove CVEs from code',
    optimize:
      'replace dependencies with better alternatives from Socket registry',
    package: 'check safety score and rating of a package',
    scan: 'scan project for security vulnerabilities and issues',
  } as const

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [action, description] of Object.entries(commandDescriptions)) {
    if (description) {
      // eslint-disable-next-line no-await-in-loop
      const embedding = await getEmbedding(description)
      /* c8 ignore start -- defensive: getEmbedding always returns undefined while the ONNX pipeline is disabled. */
      if (embedding) {
        commandEmbeddings[action] = embedding
      }
      /* c8 ignore stop */
    }
  }
}

/**
 * Get the embedding for a text string. Returns null when the pipeline is
 * unavailable or the underlying call throws.
 */
export async function getEmbedding(
  text: string,
): Promise<Float32Array | undefined> {
  const model = await getEmbeddingPipeline()
  if (!model) {
    return undefined
  }
  /* c8 ignore start -- defensive: model is always undefined while the ONNX pipeline is disabled, so this branch is unreachable. */
  try {
    const result = await model.embed(text)
    return result.embedding
  } catch (_e) {
    // Silently fail — pattern matching will handle the query.
    return undefined
  }
  /* c8 ignore stop */
}

/**
 * Lazily load the ONNX embedding pipeline. Currently disabled due to ONNX
 * Runtime build issues — always returns null and marks the pipeline as
 * permanently failed so subsequent calls short-circuit.
 *
 * Re-enabling requires uncommenting the MiniLMInference import below and
 * verifying the WASM bundle ships with the SEA build.
 */
export async function getEmbeddingPipeline() {
  /* c8 ignore start -- defensive: embeddingPipeline is a constant `undefined` while the ONNX pipeline is disabled. */
  if (embeddingPipeline) {
    return embeddingPipeline
  }
  /* c8 ignore stop */
  if (embeddingPipelineFailure) {
    return undefined
  }
  try {
    // TEMPORARILY DISABLED: ONNX Runtime build issues.
    // Load our custom MiniLM inference engine.
    // This uses direct ONNX Runtime + embedded WASM (no transformers.js).
    // Note: model is optional — pattern matching works fine without it.
    // const { MiniLMInference } = await import('../../util/minilm-inference.mts')
    // embeddingPipeline = await MiniLMInference.create()
    // return embeddingPipeline

    // Temporarily fall back to pattern matching only.
    embeddingPipelineFailure = true
    return undefined
  } /* c8 ignore start -- defensive: the try block above only contains synchronous assignments and a return, so the catch is unreachable. */ catch (_e) {
    // Model not available — silently fall back to pattern matching.
    embeddingPipelineFailure = true
    return undefined
  }
  /* c8 ignore stop */
}

/**
 * Score the query against pre-computed command embeddings and return the best
 * match if it clears 0.5 cosine similarity. Returns null when the embedding
 * pipeline is unavailable, the query embeds to null, or no command meets the
 * threshold.
 */
export async function onnxSemanticMatch(query: string): Promise<
  | {
      action: string
      confidence: number
    }
  | undefined
> {
  await ensureCommandEmbeddings()

  const queryEmbedding = await getEmbedding(query)
  if (!queryEmbedding || !Object.keys(commandEmbeddings).length) {
    return undefined
  }

  /* c8 ignore start -- defensive: queryEmbedding is always undefined and commandEmbeddings always empty while the ONNX pipeline is disabled, so the early-return above always fires. */
  let bestAction = ''
  let bestScore = 0

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [action, embedding] of Object.entries(commandEmbeddings)) {
    const similarity = cosineSimilarity(queryEmbedding, embedding)
    if (similarity > bestScore) {
      bestScore = similarity
      bestAction = action
    }
  }

  // Require minimum 0.5 similarity to use ONNX match.
  if (bestScore < 0.5) {
    return undefined
  }

  return { action: bestAction, confidence: bestScore }
  /* c8 ignore stop */
}
