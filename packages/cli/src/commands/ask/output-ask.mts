/* oxlint-disable socket/no-status-emoji -- TUI / custom output formatter; emojis are part of the visual contract. */

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
const logger = getDefaultLogger()

interface OutputAskCommandOptions {
  query: string
  intent: {
    action: string
    command: string[]
    confidence: number
    explanation: string
    packageName?: string | undefined
    severity?: string | undefined
    environment?: string | undefined
    isDryRun?: boolean | undefined
  }
  context: {
    hasPackageJson: boolean
    dependencies?: Record<string, string> | undefined
    devDependencies?: Record<string, string> | undefined
  }
  explain: boolean
}

/**
 * Explain what the command does.
 */
export function explainCommand(intent: {
  action: string
  command: string[]
  severity?: string | undefined
  environment?: string | undefined
  isDryRun?: boolean | undefined
}): string {
  const parts = []

  switch (intent.action) {
    case 'scan':
      parts.push('  • Creates a new security scan of your project')
      parts.push('  • Analyzes all dependencies for vulnerabilities')
      parts.push('  • Checks for supply chain attacks, typosquatting, etc.')
      if (intent.severity) {
        parts.push(
          `  • Filters results to show only ${intent.severity} severity issues`,
        )
      }
      if (intent.environment === 'production') {
        parts.push(
          '  • Scans only production dependencies (not dev dependencies)',
        )
      }
      break

    case 'package':
      parts.push('  • Checks the security score of a specific package')
      parts.push('  • Shows alerts, vulnerabilities, and quality metrics')
      parts.push('  • Provides a 0-100 score based on multiple factors')
      break

    case 'fix':
      parts.push('  • Applies package updates to fix GitHub security alerts')
      parts.push('  • Updates vulnerable packages to safe versions')
      if (intent.isDryRun) {
        parts.push(
          '  • Preview mode: shows what would change without making changes',
        )
      } else {
        parts.push(
          '  • WARNING: This will modify your package.json and lockfile',
        )
      }
      if (intent.severity) {
        parts.push(`  • Only fixes ${intent.severity} severity issues`)
      }
      break

    case 'patch':
      parts.push('  • Directly patches code to remove CVEs')
      parts.push('  • Applies surgical fixes to vulnerable code paths')
      parts.push('  • Creates patch files in your project')
      if (intent.isDryRun) {
        parts.push(
          '  • Preview mode: shows available patches without applying them',
        )
      }
      break

    case 'optimize':
      parts.push('  • Replaces dependencies with Socket registry alternatives')
      parts.push(
        '  • Uses enhanced versions with better security and performance',
      )
      parts.push('  • Adds overrides to your package.json')
      if (intent.isDryRun) {
        parts.push(
          '  • Preview mode: shows recommendations without making changes',
        )
      }
      break

    case 'issues':
      parts.push('  • Lists all detected issues in your dependencies')
      parts.push('  • Shows severity, type, and affected packages')
      if (intent.severity) {
        parts.push(`  • Filtered to ${intent.severity} severity issues only`)
      }
      break

    default:
      parts.push('  • Runs the interpreted command')
  }

  return parts.join('\n')
}

/**
 * Format the ask command output.
 */
export function outputAskCommand(options: OutputAskCommandOptions): void {
  const { context, explain, intent, query } = options

  // Show the query.
  logger.log('')
  logger.log(colors.bold(colors.magenta('❯ You asked:')))
  logger.log(`  "${colors.cyan(query)}"`)
  logger.log('')

  // Show interpretation.
  logger.log(colors.bold(colors.magenta('🤖 I understood:')))
  logger.log(`  ${intent.explanation}`)

  // Show extracted details if present.
  const details = []
  if (intent.packageName) {
    details.push(`Package: ${colors.cyan(intent.packageName)}`)
  }
  if (intent.severity) {
    const severityColor =
      intent.severity === 'critical' || intent.severity === 'high'
        ? colors.red
        : intent.severity === 'medium'
          ? colors.yellow
          : colors.blue
    details.push(`Severity: ${severityColor(intent.severity)}`)
  }
  if (intent.environment) {
    details.push(`Environment: ${colors.green(intent.environment)}`)
  }
  if (intent.isDryRun) {
    details.push(`Mode: ${colors.yellow('dry-run (preview only)')}`)
  }

  if (details.length > 0) {
    logger.log(`  ${details.join(', ')}`)
  }

  // Show confidence if low.
  if (intent.confidence < 0.6) {
    logger.log('')
    logger.log(
      colors.yellow(
        '⚠️  Low confidence - the command might not match your intent exactly',
      ),
    )
  }

  logger.log('')

  // Show the command.
  logger.log(colors.bold(colors.magenta('📝 Command:')))
  logger.log(
    `  ${colors.green('$')} socket ${colors.cyan(intent.command.join(' '))}`,
  )

  // Show explanation if requested.
  if (explain) {
    logger.log('')
    logger.log(colors.bold(colors.magenta('💡 Explanation:')))
    logger.log(explainCommand(intent))
  }

  // Show context.
  if (context.hasPackageJson && explain) {
    logger.log('')
    logger.log(colors.bold(colors.magenta('📦 Project Context:')))
    const depCount = Object.keys(context.dependencies || {}).length
    const devDepCount = Object.keys(context.devDependencies || {}).length
    logger.log(`  Dependencies: ${depCount} packages`)
    logger.log(`  Dev Dependencies: ${devDepCount} packages`)
  }
}
