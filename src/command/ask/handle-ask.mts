import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { outputAskCommand } from './output-ask.mts'
import { normalizeQuery, wordOverlapMatch } from './word-overlap-match.mts'

const logger = getDefaultLogger()

// Low-scoring patterns also try deterministic word overlap.
const PATTERN_MATCH_THRESHOLD = 0.6

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
  // Issues patterns (lowest priority - descriptive words).
  issues: {
    keywords: ['problem', 'alert', 'warning', 'concern'],
    command: ['scan', 'create'],
    explanation: 'Finding issues in your dependencies',
    priority: 1,
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
  // Package safety patterns, medium priority.
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
  // Patch patterns (high priority - specific action).
  patch: {
    keywords: ['patch', 'apply patch'],
    command: ['patch'],
    explanation: 'Directly patching code to remove CVEs',
    priority: 3,
  },
  // Scan patterns, medium priority.
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
} as const

export type AskPattern = (typeof PATTERNS)[Exclude<
  keyof typeof PATTERNS,
  '__proto__'
>]

// Widened view of PATTERNS for dynamic action strings from the semantic
// matchers — plain assignment widening, no assertion needed. `null` appears in
// the value union only because TS models the literal's `__proto__: null`
// prototype marker as a property; lookupPattern folds it away.
const PATTERNS_BY_ACTION: Record<string, AskPattern | null | undefined> =
  PATTERNS

/**
 * Severity levels mapping.
 */
const SEVERITY_KEYWORDS = {
  __proto__: null,
  critical: ['critical', 'severe', 'urgent', 'blocker'],
  high: ['high', 'important', 'major'],
  low: ['low', 'minor', 'trivial'],
  medium: ['medium', 'moderate', 'normal'],
} as const

/**
 * Environment keywords.
 */
const ENVIRONMENT_KEYWORDS = {
  __proto__: null,
  development: ['development', 'dev'],
  production: ['production', 'prod'],
} as const

export function getCliReentryArgv(
  command: string[] | readonly string[],
): string[] | undefined {
  const entryPath = process.argv[1]
  return entryPath ? [entryPath, ...command] : undefined
}

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

export interface HandleAskOptions {
  execute?: boolean | undefined
  explain?: boolean | undefined
}

/**
 * Main handler for ask command.
 */
export async function handleAsk(
  query: string,
  options?: HandleAskOptions | undefined,
): Promise<void> {
  const { execute = false, explain = false } = {
    __proto__: null,
    ...options,
  } as HandleAskOptions

  // Parse the intent.
  const intent = await parseIntent(query)

  if (!intent) {
    outputAskCommand(query, undefined, { hasPackageJson: false }, { explain })
    return
  }

  // Get project context.
  const context = await getProjectContext(process.cwd())

  // Show what we understood.
  outputAskCommand(query, intent, context, { explain })

  // If not executing, just show the command.
  if (!execute) {
    logger.log('')
    logger.log('Tip: Add --execute or -e to run this command directly')
    return
  }

  // Execute the command.
  logger.log('')
  logger.log('Executing…')
  logger.log('')

  const reentryArgv = getCliReentryArgv(intent.command)
  if (!reentryArgv) {
    logger.error(
      `Unable to re-run the Socket CLI: the entry script is unknown (process.argv[1] is empty). Run it yourself: socket ${intent.command.join(' ')}`,
    )
    process.exit(1)
  }

  const result = await spawn(process.execPath, reentryArgv, {
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
 * Look up a PATTERNS entry from a dynamic matcher action string.
 */
export function lookupPattern(action: string): AskPattern | undefined {
  return PATTERNS_BY_ACTION[action] ?? undefined
}

/**
 * Parse natural language query into structured intent.
 */
export async function parseIntent(
  query: string,
): Promise<ParsedIntent | undefined> {
  // Normalize the query to handle verb tenses, plurals, etc.
  const lowerQuery = normalizeQuery(query)

  // Check for dry run.
  const isDryRun =
    lowerQuery.includes('dry run') || lowerQuery.includes('preview')

  const packageName = extractQueryPackage()
  function extractQueryPackage(): string | undefined {
    let extractedPackageName: string | undefined
    const quotedMatch = query.match(/['"]([^'"]+)['"]/)
    if (quotedMatch) {
      extractedPackageName = quotedMatch[1]
    } else {
      // Extract a package name after a supported query verb.
      // Must look like a real package (has @, /, or contains common package patterns).
      // (?:about|check|is|trust|with) — trigger verbs (non-capturing)
      // \s+                     — one or more whitespace chars after the verb
      // ([a-z0-9-@/]+)          — capture: package-name chars (letters, digits, dash, @, slash)
      const extractedPackageNameRe =
        /(?:about|check|is|trust|with)\s+([a-z0-9-@/]+)/i
      const pkgMatch = query.toLowerCase().match(extractedPackageNameRe)
      if (pkgMatch) {
        const candidate = pkgMatch[1]
        // Only accept if it looks like a real package name, not common words.
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
            'package',
            'dependency',
          ]
          if (!commonWords.includes(candidate)) {
            extractedPackageName = candidate
          }
        }
      }
    }

    return extractedPackageName
  }

  // Detect severity.
  let severity: string | undefined
  const severityEntries = (['critical', 'high', 'medium', 'low'] as const).map(
    severityKey => [severityKey, SEVERITY_KEYWORDS[severityKey]] as const,
  )
  for (const [level, keywords] of severityEntries) {
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
  const environmentEntries = (['production', 'development'] as const).map(
    environmentKey =>
      [environmentKey, ENVIRONMENT_KEYWORDS[environmentKey]] as const,
  )
  for (const [env, keywords] of environmentEntries) {
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

  if (packageName && /\babout\b/u.test(lowerQuery)) {
    bestMatch = {
      action: 'package',
      command: [...PATTERNS.package.command],
      explanation: PATTERNS.package.explanation,
      confidence: 1,
      score: 1,
    }
  }
  matchIntentPatterns()
  function matchIntentPatterns(): void {
    const patternEntries = (
      ['fix', 'patch', 'optimize', 'package', 'scan', 'issues'] as const
    ).map(patternKey => [patternKey, PATTERNS[patternKey]] as const)
    for (const [action, pattern] of patternEntries) {
      if (
        !pattern ||
        (action === 'package' && !packageName && /\bscan\b/u.test(lowerQuery))
      ) {
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
  }

  await matchSemanticIntent()
  async function matchSemanticIntent(): Promise<void> {
    // Hybrid semantic matching: try multiple strategies if confidence is low.
    if (!bestMatch || bestMatch.confidence < PATTERN_MATCH_THRESHOLD) {
      // Strategy 1: Fast word-overlap matching (~0ms, 80-90% accuracy).
      const wordMatch = await wordOverlapMatch(query)

      if (wordMatch && wordMatch.confidence > (bestMatch?.confidence || 0)) {
        // Use word-overlap match.
        /* c8 ignore start - word-overlap match selected branch; requires wordOverlapMatch to return a specific PATTERNS-keyed action that beats the current pattern-match confidence; tests cover the matchers in isolation */
        const pattern = lookupPattern(wordMatch.action)
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
    }
  }

  if (!bestMatch || (bestMatch.action === 'package' && !packageName)) {
    return undefined
  }

  return buildIntentCommand(bestMatch)

  function buildIntentCommand(intentMatch: ParsedIntent): ParsedIntent {
    // Build final command with modifiers.
    const command = [...intentMatch.command]

    // Add package name if detected and command supports it.
    if (packageName && intentMatch.action === 'package') {
      command.push(packageName)
    }

    // Add severity flag.
    if (
      severity &&
      (intentMatch.action === 'fix' || intentMatch.action === 'scan')
    ) {
      command.push(`--severity=${severity}`)
    }

    // Add environment flag.
    if (environment === 'production' && intentMatch.action === 'scan') {
      command.push('--prod')
    }

    // Add dry run flag for destructive commands.
    if (
      isDryRun ||
      (intentMatch.action === 'fix' && !lowerQuery.includes('execute'))
    ) {
      command.push('--dry-run')
    }

    const result: ParsedIntent = {
      action: intentMatch.action,
      command,
      confidence: intentMatch.confidence,
      explanation: intentMatch.explanation,
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
}
