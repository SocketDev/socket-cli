import { promises as fs } from 'node:fs'
import path from 'node:path'

import nlp from 'compromise'

import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
// Import compromise for NLP text normalization.

import { outputAskCommand } from './output-ask.mts'

// Semantic index for fast word-overlap matching (lazy-loaded, ~3KB).
let semanticIndex: any = null

// ONNX embedding pipeline for deep semantic matching (lazy-loaded, ~17MB model).
let embeddingPipeline: any = null
let embeddingPipelineFailure: boolean = false
const commandEmbeddings: Record<string, Float32Array> = {}

// Confidence thresholds.
const WORD_OVERLAP_THRESHOLD = 0.3 // Minimum for word overlap match.
const PATTERN_MATCH_THRESHOLD = 0.6 // If below this, try ONNX fallback.

export interface HandleAskOptions {
  query: string
  execute: boolean
  explain: boolean
}

interface ParsedIntent {
  action: string
  command: string[]
  confidence: number
  explanation: string
  packageName?: string
  severity?: string
  environment?: string
  isDryRun?: boolean
}

/**
 * Pattern matching rules for natural language.
 */
const PATTERNS = {
  __proto__: null,
  // Fix patterns (highest priority - action words).
  fix: {
    keywords: ['fix', 'resolve', 'repair', 'remediate', 'update', 'upgrade'],
    command: ['fix'],
    explanation: 'Applying package updates to fix GitHub security alerts',
    priority: 3,
  },
  // Patch patterns (high priority - specific action).
  patch: {
    keywords: ['patch', 'apply patch'],
    command: ['patch'],
    explanation: 'Directly patching code to remove CVEs',
    priority: 3,
  },
  // Optimize patterns (high priority - action words).
  optimize: {
    keywords: ['optimize', 'enhance', 'improve', 'replace', 'alternative', 'better'],
    command: ['optimize'],
    explanation: 'Replacing dependencies with Socket registry alternatives',
    priority: 3,
  },
  // Package safety patterns (medium priority).
  package: {
    keywords: ['safe', 'trust', 'score', 'rating', 'quality', 'package', 'dependency'],
    command: ['package', 'score'],
    explanation: 'Checking package security score',
    priority: 2,
  },
  // Scan patterns (medium priority).
  scan: {
    keywords: ['scan', 'check', 'vulnerabilit', 'audit', 'analyze', 'inspect', 'review'],
    command: ['scan', 'create'],
    explanation: 'Scanning your project for security vulnerabilities',
    priority: 2,
  },
  // Issues patterns (lowest priority - descriptive words).
  issues: {
    keywords: ['problem', 'alert', 'warning', 'concern'],
    command: ['scan', 'create'],
    explanation: 'Finding issues in your dependencies',
    priority: 1,
  },
} as const

/**
 * Severity levels mapping.
 */
const SEVERITY_KEYWORDS = {
  __proto__: null,
  critical: ['critical', 'severe', 'urgent', 'blocker'],
  high: ['high', 'important', 'major'],
  medium: ['medium', 'moderate', 'normal'],
  low: ['low', 'minor', 'trivial'],
} as const

/**
 * Environment keywords.
 */
const ENVIRONMENT_KEYWORDS = {
  __proto__: null,
  production: ['production', 'prod'],
  development: ['development', 'dev'],
} as const

/**
 * Normalize query using NLP to handle variations in phrasing.
 * Converts verbs to infinitive and nouns to singular for better matching.
 */
function normalizeQuery(query: string): string {
  try {
    const doc = nlp(query)

    // Normalize verbs to infinitive form: "fixing" → "fix", "scanned" → "scan".
    doc.verbs().toInfinitive()

    // Normalize nouns to singular: "vulnerabilities" → "vulnerability".
    doc.nouns().toSingular()

    return doc.out('text').toLowerCase()
  } catch (e) {
    // Fallback to original query if NLP fails.
    return query.toLowerCase()
  }
}

/**
 * Lazily load the pre-computed semantic index.
 * NO ML models - just word overlap + synonyms (~3KB).
 */
async function loadSemanticIndex() {
  if (semanticIndex) {
    return semanticIndex
  }

  try {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE']
    if (!homeDir) {
      return null
    }
    const indexPath = path.join(homeDir, '.claude/skills/socket-cli/semantic-index.json')

    const content = await fs.readFile(indexPath, 'utf-8')
    semanticIndex = JSON.parse(content)

    return semanticIndex
  } catch (e) {
    // Semantic index not available - not a critical error.
    return null
  }
}

/**
 * Extract meaningful words from text (lowercase, >2 chars).
 */
function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
}

/**
 * Compute word overlap score between query and command.
 * Uses Jaccard similarity: |intersection| / |union|.
 */
function wordOverlap(queryWords: Set<string>, commandWords: string[]): number {
  const commandSet = new Set(commandWords)
  const intersection = new Set([...queryWords].filter(w => commandSet.has(w)))
  const union = new Set([...queryWords, ...commandWords])

  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Find best matching command using word overlap + synonym expansion.
 * Fast path - NO ML models, pure JavaScript, ~3KB overhead.
 */
async function wordOverlapMatch(query: string): Promise<{
  action: string
  confidence: number
} | null> {
  const index = await loadSemanticIndex()
  if (!index || !index.commands) {
    return null
  }

  // Extract query words.
  const queryWords = new Set(extractWords(query))

  if (queryWords.size === 0) {
    return null
  }

  let bestAction = ''
  let bestScore = 0

  // Match against each command's word index.
  for (const [commandName, commandData] of Object.entries(index.commands)) {
    if (!commandData || typeof commandData !== 'object' || !('words' in commandData) || !Array.isArray(commandData.words)) {
      continue
    }
    const score = wordOverlap(queryWords, commandData.words)

    if (score > bestScore) {
      bestScore = score
      bestAction = commandName
    }
  }

  // Require minimum overlap threshold.
  if (bestScore < WORD_OVERLAP_THRESHOLD) {
    return null
  }

  return {
    action: bestAction,
    confidence: bestScore,
  }
}

/**
 * Lazily load the ONNX embedding pipeline for deep semantic matching.
 * Only loads when word-overlap matching has low confidence.
 */
async function getEmbeddingPipeline() {
  if (embeddingPipeline) {
    return embeddingPipeline
  }

  // If we already failed to load, don't try again.
  if (embeddingPipelineFailure) {
    return null
  }

  try {
    // Load our custom MiniLM inference engine.
    // This uses direct ONNX Runtime + embedded WASM (no transformers.js).
    // Note: Model is optional - pattern matching works fine without it.
    const { MiniLMInference } = await import('../../utils/minilm-inference.mts')
    embeddingPipeline = await MiniLMInference.create()

    return embeddingPipeline
  } catch (e) {
    // Model not available - silently fall back to pattern matching.
    embeddingPipelineFailure = true
    return null
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Since our embeddings are already normalized, this is just dot product.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
 * Get embedding for a text string using ONNX Runtime.
 */
async function getEmbedding(text: string): Promise<Float32Array | null> {
  const model = await getEmbeddingPipeline()
  if (!model) {
    return null
  }

  try {
    const result = await model.embed(text)
    return result.embedding
  } catch (e) {
    // Silently fail - pattern matching will handle the query.
    return null
  }
}

/**
 * Pre-compute embeddings for all command patterns.
 */
async function ensureCommandEmbeddings() {
  if (Object.keys(commandEmbeddings).length > 0) {
    return
  }

  const commandDescriptions = {
    __proto__: null,
    fix: 'fix vulnerabilities by updating packages to secure versions',
    patch: 'apply patches to remove CVEs from code',
    optimize: 'replace dependencies with better alternatives from Socket registry',
    package: 'check safety score and rating of a package',
    scan: 'scan project for security vulnerabilities and issues',
  } as const

  for (const [action, description] of Object.entries(commandDescriptions)) {
    if (description) {
      // eslint-disable-next-line no-await-in-loop
      const embedding = await getEmbedding(description)
      if (embedding) {
        commandEmbeddings[action] = embedding
      }
    }
  }
}

/**
 * Find best matching command using ONNX embeddings.
 * Fallback for when word-overlap has low confidence - slower but more accurate.
 */
async function onnxSemanticMatch(query: string): Promise<{
  action: string
  confidence: number
} | null> {
  await ensureCommandEmbeddings()

  const queryEmbedding = await getEmbedding(query)
  if (!queryEmbedding || Object.keys(commandEmbeddings).length === 0) {
    return null
  }

  let bestAction = ''
  let bestScore = 0

  for (const [action, embedding] of Object.entries(commandEmbeddings)) {
    const similarity = cosineSimilarity(queryEmbedding, embedding)
    if (similarity > bestScore) {
      bestScore = similarity
      bestAction = action
    }
  }

  // Require minimum 0.5 similarity to use ONNX match.
  if (bestScore < 0.5) {
    return null
  }

  return {
    action: bestAction,
    confidence: bestScore,
  }
}

/**
 * Parse natural language query into structured intent.
 */
async function parseIntent(query: string): Promise<ParsedIntent> {
  // Normalize the query to handle verb tenses, plurals, etc.
  const lowerQuery = normalizeQuery(query)

  // Check for dry run.
  const isDryRun = lowerQuery.includes('dry run') || lowerQuery.includes('preview')

  // Extract package name from original query (not normalized).
  let packageName: string | undefined
  const quotedMatch = query.match(/['"]([^'"]+)['"]/)
  if (quotedMatch) {
    packageName = quotedMatch[1]
  } else {
    // Try to find package name after "is", "check", "about", "with".
    // Must look like a real package (has @, /, or contains common package patterns).
    const pkgMatch = query.toLowerCase().match(/(?:is|check|about|with)\s+([a-z0-9-@/]+)/i)
    if (pkgMatch) {
      const candidate = pkgMatch[1]
      // Only accept if it looks like a real package name (not common words).
      if (candidate && (candidate.includes('@') || candidate.includes('/') || candidate.match(/^[a-z0-9-]+$/))) {
        // Reject common command words.
        const commonWords = ['scan', 'fix', 'patch', 'optimize', 'vulnerabilities', 'issues', 'problems', 'alerts', 'security', 'safe', 'check']
        if (!commonWords.includes(candidate)) {
          packageName = candidate
        }
      }
    }
  }

  // Detect severity.
  let severity: string | undefined
  for (const [level, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (Array.isArray(keywords) && keywords.some(kw => lowerQuery.includes(kw))) {
      severity = level
      break
    }
  }

  // Detect environment.
  let environment: string | undefined
  for (const [env, keywords] of Object.entries(ENVIRONMENT_KEYWORDS)) {
    if (Array.isArray(keywords) && keywords.some(kw => lowerQuery.includes(kw))) {
      environment = env
      break
    }
  }

  // Match against patterns.
  let bestMatch: {
    action: string
    command: string[]
    explanation: string
    confidence: number
    score: number
  } | null = null

  for (const [action, pattern] of Object.entries(PATTERNS)) {
    if (!pattern) {
      continue
    }
    const matchCount = pattern.keywords.filter(kw => lowerQuery.includes(kw)).length

    if (matchCount > 0) {
      const confidence = matchCount / pattern.keywords.length
      // Priority-weighted score: higher priority patterns win ties.
      const score = confidence * (pattern.priority || 1)

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          action,
          command: [...pattern.command],
          explanation: pattern.explanation,
          confidence,
          score,
        }
      }
    }
  }

  // Hybrid semantic matching: try multiple strategies if confidence is low.
  if (!bestMatch || bestMatch.confidence < PATTERN_MATCH_THRESHOLD) {
    // Strategy 1: Fast word-overlap matching (~0ms, 80-90% accuracy).
    const wordMatch = await wordOverlapMatch(query)

    if (wordMatch && wordMatch.confidence > (bestMatch?.confidence || 0)) {
      // Use word-overlap match.
      const pattern = PATTERNS[wordMatch.action as keyof typeof PATTERNS]
      if (pattern) {
        bestMatch = {
          action: wordMatch.action,
          command: [...pattern.command],
          explanation: pattern.explanation,
          confidence: wordMatch.confidence,
          score: wordMatch.confidence,
        }
      }
    }

    // Strategy 2: ONNX semantic matching (50-80ms, 95-98% accuracy).
    // Only try if still low confidence.
    if (!bestMatch || bestMatch.confidence < 0.5) {
      const onnxMatch = await onnxSemanticMatch(query)

      if (onnxMatch && onnxMatch.confidence > (bestMatch?.confidence || 0)) {
        // Use ONNX semantic match.
        const pattern = PATTERNS[onnxMatch.action as keyof typeof PATTERNS]
        if (pattern) {
          bestMatch = {
            action: onnxMatch.action,
            command: [...pattern.command],
            explanation: pattern.explanation,
            confidence: onnxMatch.confidence,
            score: onnxMatch.confidence,
          }
        }
      }
    }
  }

  // Default to scan if still no match.
  if (!bestMatch) {
    bestMatch = {
      action: 'scan',
      command: ['scan', 'create'],
      explanation: 'Scanning your project',
      confidence: 0.5,
      score: 0.5,
    }
  }

  // Build final command with modifiers.
  const command = [...bestMatch.command]

  // Add package name if detected and command supports it.
  if (packageName && bestMatch.action === 'package') {
    command.push(packageName)
  }

  // Add severity flag.
  if (severity && (bestMatch.action === 'fix' || bestMatch.action === 'scan')) {
    command.push(`--severity=${severity}`)
  }

  // Add environment flag.
  if (environment === 'production' && bestMatch.action === 'scan') {
    command.push('--prod')
  }

  // Add dry run flag for destructive commands.
  if (isDryRun || (bestMatch.action === 'fix' && !lowerQuery.includes('execute'))) {
    command.push('--dry-run')
  }

  const result: ParsedIntent = {
    action: bestMatch.action,
    command,
    confidence: bestMatch.confidence,
    explanation: bestMatch.explanation,
    isDryRun,
  }

  if (packageName !== undefined) {
    result.packageName = packageName
  }
  if (severity !== undefined) {
    result.severity = severity
  }
  if (environment !== undefined) {
    result.environment = environment
  }

  return result
}

/**
 * Read package.json to get context.
 */
async function getProjectContext(cwd: string): Promise<{
  hasPackageJson: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}> {
  try {
    const pkgPath = path.join(cwd, 'package.json')
    const content = await fs.readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(content)
    return {
      hasPackageJson: true,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    }
  } catch (e) {
    return { hasPackageJson: false }
  }
}

/**
 * Main handler for ask command.
 */
export async function handleAsk(options: HandleAskOptions): Promise<void> {
  const { execute, explain, query } = options

  // Parse the intent.
  const intent = await parseIntent(query)

  // Get project context.
  const context = await getProjectContext(process.cwd())

  // Show what we understood.
  outputAskCommand({
    query,
    intent,
    context,
    explain,
  })

  // If not executing, just show the command.
  if (!execute) {
    logger.log('')
    logger.log('💡 Tip: Add --execute or -e to run this command directly')
    return
  }

  // Execute the command.
  logger.log('')
  logger.log('🚀 Executing...')
  logger.log('')

  const result = await spawn('socket', intent.command, {
    stdio: 'inherit',
    cwd: process.cwd(),
  })

  if (result.code !== 0) {
    logger.error(`Command failed with exit code ${result.code}`)
    // eslint-disable-next-line n/no-process-exit
    process.exit(result.code)
  }
}
