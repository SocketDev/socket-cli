import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { onnxSemanticMatch } from './onnx-match.mts'
import { outputAskCommand } from './output-ask.mts'
import { normalizeQuery, wordOverlapMatch } from './word-overlap-match.mts'

// Re-export the matchers + helpers so existing import paths keep working.
export {
  cosineSimilarity,
  ensureCommandEmbeddings,
  getEmbedding,
  getEmbeddingPipeline,
  onnxSemanticMatch,
} from './onnx-match.mts'
export {
  extractWords,
  loadSemanticIndex,
  normalizeQuery,
  wordOverlap,
  wordOverlapMatch,
} from './word-overlap-match.mts'

const logger = getDefaultLogger()

// Confidence threshold: pattern-match scores below this trigger the ONNX
// semantic-match fallback (currently a no-op; see onnx-match.mts).
const PATTERN_MATCH_THRESHOLD = 0.6

export interface HandleAskOptions {
  query: string
  execute: boolean
  explain: boolean
}

export interface ParsedIntent {
  action: string
  command: string[]
  confidence: number
  explanation: string
  packageName?: string | undefined
  severity?: string | undefined
  environment?: string | undefined
  isDryRun?: boolean | undefined
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
    keywords: [
      'optimize',
      'enhance',
      'improve',
      'replace',
      'alternative',
      'better',
    ],
    command: ['optimize'],
    explanation: 'Replacing dependencies with Socket registry alternatives',
    priority: 3,
  },
  // Package safety patterns (medium priority).
  package: {
    keywords: [
      'safe',
      'trust',
      'score',
      'rating',
      'quality',
      'package',
      'dependency',
    ],
    command: ['package', 'score'],
    explanation: 'Checking package security score',
    priority: 2,
  },
  // Scan patterns (medium priority).
  scan: {
    keywords: [
      'scan',
      'check',
      'vulnerabilit',
      'audit',
      'analyze',
      'inspect',
      'review',
    ],
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
 * Read package.json to get context.
 */
export async function getProjectContext(cwd: string): Promise<{
  hasPackageJson: boolean
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
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
  } catch (_e) {
    return { hasPackageJson: false }
  }
}

/**
 * Main handler for ask command.
 */
export async function handleAsk(options: HandleAskOptions): Promise<void> {
  const { execute, explain, query } = {
    __proto__: null,
    ...options,
  } as typeof options

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
  logger.log('🚀 Executing…')
  logger.log('')

  const result = await spawn('socket', intent.command, {
    stdio: 'inherit',
    cwd: process.cwd(),
  })

  if (!result) {
    logger.error('Failed to execute command')
    process.exit(1)
  }

  if (result.code !== 0) {
    logger.error(`Command failed with exit code ${result.code}`)
    process.exit(result.code)
  }
}

/**
 * Parse natural language query into structured intent.
 */
export async function parseIntent(query: string): Promise<ParsedIntent> {
  // Normalize the query to handle verb tenses, plurals, etc.
  const lowerQuery = normalizeQuery(query)

  // Check for dry run.
  const isDryRun =
    lowerQuery.includes('dry run') || lowerQuery.includes('preview')

  // Extract package name from original query (not normalized).
  let packageName: string | undefined
  const quotedMatch = query.match(/['"]([^'"]+)['"]/)
  if (quotedMatch) {
    packageName = quotedMatch[1]
  } else {
    // Try to find package name after "is", "check", "about", "with".
    // Must look like a real package (has @, /, or contains common package patterns).
    // (?:about|check|is|with) — one of four trigger verbs (non-capturing)
    // \s+                     — one or more whitespace chars after the verb
    // ([a-z0-9-@/]+)          — capture: package-name chars (letters, digits, dash, @, slash)
    const packageNameRe = /(?:about|check|is|with)\s+([a-z0-9-@/]+)/i
    const pkgMatch = query.toLowerCase().match(packageNameRe)
    if (pkgMatch) {
      const candidate = pkgMatch[1]
      // Only accept if it looks like a real package name (not common words).
      if (
        candidate &&
        (candidate.includes('@') ||
          candidate.includes('/') ||
          candidate.match(/^[a-z0-9-]+$/))
      ) {
        // Reject common command words.
        const commonWords = [
          'scan',
          'fix',
          'patch',
          'optimize',
          'vulnerabilities',
          'issues',
          'problems',
          'alerts',
          'security',
          'safe',
          'check',
        ]
        if (!commonWords.includes(candidate)) {
          packageName = candidate
        }
      }
    }
  }

  // Detect severity.
  let severity: string | undefined
  for (const [level, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (
      Array.isArray(keywords) &&
      keywords.some(kw => lowerQuery.includes(kw))
    ) {
      severity = level
      break
    }
  }

  // Detect environment.
  let environment: string | undefined
  for (const [env, keywords] of Object.entries(ENVIRONMENT_KEYWORDS)) {
    if (
      Array.isArray(keywords) &&
      keywords.some(kw => lowerQuery.includes(kw))
    ) {
      environment = env
      break
    }
  }

  // Match against patterns.
  let bestMatch:
    | {
        action: string
        command: string[]
        explanation: string
        confidence: number
        score: number
      }
    | undefined = undefined

  for (const [action, pattern] of Object.entries(PATTERNS)) {
    if (!pattern) {
      continue
    }
    const matchCount = pattern.keywords.filter(kw =>
      lowerQuery.includes(kw),
    ).length

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
      /* c8 ignore start - word-overlap match selected branch; requires wordOverlapMatch to return a specific PATTERNS-keyed action that beats the current pattern-match confidence; tests cover the matchers in isolation */
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
      /* c8 ignore stop */
    }

    // Strategy 2: ONNX semantic matching (50-80ms, 95-98% accuracy).
    // Only try if still low confidence.
    if (!bestMatch || bestMatch.confidence < 0.5) {
      const onnxMatch = await onnxSemanticMatch(query)

      if (onnxMatch && onnxMatch.confidence > (bestMatch?.confidence || 0)) {
        // Use ONNX semantic match.
        /* c8 ignore start - ONNX match selected branch; requires onnxSemanticMatch to return a specific PATTERNS-keyed action that beats the current confidence; tests cover the matchers in isolation */
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
        /* c8 ignore stop */
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
  if (
    isDryRun ||
    (bestMatch.action === 'fix' && !lowerQuery.includes('execute'))
  ) {
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
