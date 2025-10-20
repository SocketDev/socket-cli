import { promises as fs } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { outputAskCommand } from './output-ask.mts'

import type { CResult } from '../../utils/c-result.mts'

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
 * Parse natural language query into structured intent.
 */
function parseIntent(query: string): ParsedIntent {
  const lowerQuery = query.toLowerCase()

  // Check for dry run.
  const isDryRun = lowerQuery.includes('dry run') || lowerQuery.includes('preview')

  // Extract package name (looks for quoted strings or common patterns).
  let packageName: string | undefined
  const quotedMatch = query.match(/['"]([^'"]+)['"]/)
  if (quotedMatch) {
    packageName = quotedMatch[1]
  } else {
    // Try to find package name after "is", "check", etc.
    const pkgMatch = lowerQuery.match(/(?:is|check|for|about|with)\s+([a-z0-9-@/]+)/i)
    if (pkgMatch) {
      packageName = pkgMatch[1]
    }
  }

  // Detect severity.
  let severity: string | undefined
  for (const [level, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) {
      severity = level
      break
    }
  }

  // Detect environment.
  let environment: string | undefined
  for (const [env, keywords] of Object.entries(ENVIRONMENT_KEYWORDS)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) {
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

  // Default to scan if no match.
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

  return {
    action: bestMatch.action,
    command,
    confidence: bestMatch.confidence,
    explanation: bestMatch.explanation,
    packageName,
    severity,
    environment,
    isDryRun,
  }
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
  const { query, execute, explain } = options

  // Parse the intent.
  const intent = parseIntent(query)

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

  try {
    const result = await spawn('socket', intent.command, {
      stdio: 'inherit',
      cwd: process.cwd(),
    })

    if (result.code !== 0) {
      logger.error(`Command failed with exit code ${result.code}`)
      process.exit(result.code)
    }
  } catch (e) {
    logger.error(`Failed to execute command: ${e.message}`)
    process.exit(1)
  }
}
