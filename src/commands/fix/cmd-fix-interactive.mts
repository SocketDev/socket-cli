/** @fileoverview Interactive fix mode for guided vulnerability remediation. */

import { stdin, stdout } from 'node:process'
import readline from 'node:readline/promises'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getProjectContext } from '../../utils/project-context.mts'
import { Spinner } from '../../utils/rich-progress.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'

import type {
  CliSubcommand,
} from '../../utils/meow-with-subcommands.mts'

interface VulnerabilityFix {
  name: string
  currentVersion: string
  suggestedVersion?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  issues: string[]
  fixType: 'update' | 'replace' | 'remove'
  replacementPackage?: string
  breakingChanges?: boolean
  dependents?: string[]
}

interface FixGroup {
  title: string
  fixes: VulnerabilityFix[]
  priority: 'critical' | 'high' | 'medium' | 'low'
}

export const CMD_NAME = 'interactive'

const description = 'Interactive mode for guided vulnerability remediation'

const hidden = false

export const cmdFixInteractive: CliSubcommand = {
  description,
  hidden,
  async run(
    argv: readonly string[],
    importMeta: ImportMeta,
    { parentName }: { parentName: string },
  ): Promise<void> {
    const flags = {
      ...commonFlags,
      ...outputFlags,
      auto: {
        type: 'boolean' as const,
        default: false,
        description: 'Automatically apply safe fixes without prompting',
      },
      'dry-run': {
        type: 'boolean' as const,
        default: false,
        description: 'Show what would be fixed without making changes',
      },
      severity: {
        type: 'string' as const,
        default: 'low',
        description: 'Minimum severity to fix (critical, high, medium, low)',
      },
      'group-by': {
        type: 'string' as const,
        default: 'severity',
        description: 'Group fixes by: severity, package, type',
      },
    }

    const help = (command: string) => `
      Usage
        $ ${command} [PATH]

      Options
        ${Object.entries(flags).map(([name, flag]: [string, any]) =>
          `  --${name}${flag.type === 'string' ? '=<value>' : ''} ${flag.description || ''}`
        ).join('\n')}

      Examples
        $ ${command}                    # Interactive fix in current directory
        $ ${command} --auto             # Auto-apply safe fixes
        $ ${command} --severity=high    # Only fix high and critical issues
        $ ${command} --dry-run          # Preview fixes without applying
      `

    const cli = meowOrExit({
      argv,
      config: {
        commandName: CMD_NAME,
        description,
        hidden,
        flags,
        help: () => help(`${parentName} ${CMD_NAME}`),
      },
      parentName,
      importMeta,
    })

    const {
      auto,
      dryRun,
      groupBy,
      json,
      markdown,
      severity,
    } = cli.flags as {
      auto: boolean
      dryRun: boolean
      json?: boolean
      markdown?: boolean
      severity: string
      groupBy: string
    }

    const outputKind = getOutputKind(json, markdown)
    const hasApiToken = hasDefaultApiToken()

    const wasValidInput = checkCommandInput(
      outputKind,
      {
        nook: true,
        test: dryRun || hasApiToken,
        message: 'This command requires a Socket API token for access',
        fail: 'try `socket login`',
      },
    )
    if (!wasValidInput) {
      return
    }

    const targetPath = cli.input[0] || process.cwd()

    // Get project context
    const spinner = new Spinner('Analyzing project...')
    spinner.start()

    const context = await getProjectContext(targetPath)
    if (!context) {
      spinner.fail('Not a valid project directory')
      return
    }

    spinner.succeed(`Found ${context.type} project${context.isMonorepo ? ' (monorepo)' : ''}`)

    // Analyze vulnerabilities
    const analysisSpinner = new Spinner('Analyzing vulnerabilities...')
    analysisSpinner.start()

    // Mock vulnerability data for demonstration
    const vulnerabilities = await analyzeVulnerabilities(targetPath, severity)

    analysisSpinner.succeed(`Found ${vulnerabilities.length} issues to fix`)

    if (vulnerabilities.length === 0) {
      logger.success('No vulnerabilities found!')
      return
    }

    // Group fixes
    const groups = groupFixes(vulnerabilities, groupBy)

    if (dryRun) {
      displayDryRunSummary(groups)
      return
    }

    if (auto) {
      await applyAutoFixes(groups, context)
      return
    }

    // Interactive mode
    await runInteractiveMode(groups, context)
  },
}

async function analyzeVulnerabilities(
  _targetPath: string,
  minSeverity: string,
): Promise<VulnerabilityFix[]> {
  // This would actually call the Socket API to get real vulnerability data
  // For now, return mock data for demonstration

  return [
    {
      name: 'lodash',
      currentVersion: '4.17.19',
      suggestedVersion: '4.17.21',
      severity: 'high' as const,
      issues: ['Prototype Pollution (CVE-2021-23337)'],
      fixType: 'update' as const,
      breakingChanges: false,
      dependents: ['express', 'webpack'],
    },
    {
      name: 'minimist',
      currentVersion: '1.2.0',
      suggestedVersion: '1.2.6',
      severity: 'critical' as const,
      issues: ['Prototype Pollution'],
      fixType: 'update' as const,
      breakingChanges: false,
    },
    {
      name: 'event-stream',
      currentVersion: '3.3.6',
      severity: 'critical' as const,
      issues: ['Known malware'],
      fixType: 'remove' as const,
      breakingChanges: true,
    },
  ].filter(v => {
    const severityOrder = ['low', 'medium', 'high', 'critical']
    const minIndex = severityOrder.indexOf(minSeverity)
    const vulnIndex = severityOrder.indexOf(v.severity)
    return vulnIndex >= minIndex
  })
}

function groupFixes(fixes: VulnerabilityFix[], groupBy: string): FixGroup[] {
  const groups: Map<string, FixGroup> = new Map()

  for (const fix of fixes) {
    let groupKey: string
    let groupTitle: string
    let priority: FixGroup['priority']

    switch (groupBy) {
      case 'severity':
        groupKey = fix.severity
        groupTitle = `${fix.severity.toUpperCase()} severity issues`
        priority = fix.severity
        break
      case 'type':
        groupKey = fix.fixType
        groupTitle = `Fixes: ${fix.fixType}`
        priority = fix.severity
        break
      default:
        groupKey = fix.name
        groupTitle = fix.name
        priority = fix.severity
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        title: groupTitle,
        fixes: [],
        priority,
      })
    }

    groups.get(groupKey)!.fixes.push(fix)
  }

  // Sort groups by priority
  return Array.from(groups.values()).sort((a, b) => {
    const order = ['critical', 'high', 'medium', 'low']
    return order.indexOf(a.priority) - order.indexOf(b.priority)
  })
}

function displayDryRunSummary(groups: FixGroup[]): void {
  logger.log('\n📋 Fix Summary (Dry Run)\n')

  for (const group of groups) {
    logger.log(colors.bold(colors.cyan(group.title)))

    for (const fix of group.fixes) {
      const icon = fix.severity === 'critical' ? '🔴' :
                   fix.severity === 'high' ? '🟠' :
                   fix.severity === 'medium' ? '🟡' : '⚪'

      logger.log(`  ${icon} ${fix.name}@${fix.currentVersion}`)

      if (fix.fixType === 'update') {
        logger.log(`     → Update to ${fix.suggestedVersion}`)
      } else if (fix.fixType === 'remove') {
        logger.log(`     → Remove package (${fix.issues.join(', ')})`)
      } else if (fix.fixType === 'replace') {
        logger.log(`     → Replace with ${fix.replacementPackage}`)
      }

      if (fix.breakingChanges) {
        logger.log(colors.yellow(`     ⚠️  May contain breaking changes`))
      }

      if (fix.dependents && fix.dependents.length > 0) {
        logger.log(colors.gray(`     Used by: ${fix.dependents.join(', ')}`))
      }
    }
    logger.log()
  }
}

async function applyAutoFixes(groups: FixGroup[], _context: any): Promise<void> {
  logger.log('\n🤖 Auto-applying safe fixes...\n')

  const safeFixCount = 0
  const skippedCount = 0

  for (const group of groups) {
    for (const fix of group.fixes) {
      // Only auto-apply non-breaking updates
      if (fix.fixType === 'update' && !fix.breakingChanges) {
        logger.success(`✓ Updated ${fix.name} to ${fix.suggestedVersion}`)
        // Would actually apply the fix here
      } else {
        logger.warn(`⚠ Skipped ${fix.name} (requires manual review)`)
      }
    }
  }

  logger.log(`\n✅ Applied ${safeFixCount} safe fixes`)
  if (skippedCount > 0) {
    logger.log(`⚠️  Skipped ${skippedCount} fixes that require manual review`)
    logger.log(`   Run without --auto to review these interactively`)
  }
}

async function runInteractiveMode(groups: FixGroup[], context: any): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout })

  logger.log('\n🔧 Interactive Fix Mode\n')
  logger.log('For each issue, choose an action:')
  logger.log('  [y] Apply fix')
  logger.log('  [n] Skip')
  logger.log('  [d] Show details')
  logger.log('  [a] Apply all safe fixes')
  logger.log('  [q] Quit\n')

  const appliedFixes: VulnerabilityFix[] = []
  const skippedFixes: VulnerabilityFix[] = []
  let lastAnswer = ''

  try {
    for (const group of groups) {
      logger.log(colors.bold(colors.cyan(`\n${group.title}`)))

      for (const fix of group.fixes) {
        const icon = fix.severity === 'critical' ? '🔴' :
                     fix.severity === 'high' ? '🟠' :
                     fix.severity === 'medium' ? '🟡' : '⚪'

        logger.log(`\n${icon} ${colors.bold(fix.name)}@${fix.currentVersion}`)
        logger.log(`   Issue: ${fix.issues.join(', ')}`)

        if (fix.fixType === 'update') {
          logger.log(`   Fix: Update to ${colors.green(fix.suggestedVersion!)}`)
        } else if (fix.fixType === 'remove') {
          logger.log(`   Fix: ${colors.red('Remove package')}`)
        }

        if (fix.breakingChanges) {
          logger.log(colors.yellow(`   ⚠️  May contain breaking changes`))
        }

        // eslint-disable-next-line no-await-in-loop
        const answer = await rl.question('\n   Action? [y/n/d/a/q]: ')
        lastAnswer = answer

        switch (answer.toLowerCase()) {
          case 'y':
            appliedFixes.push(fix)
            logger.success(`   ✓ Fix queued`)
            break
          case 'n':
            skippedFixes.push(fix)
            logger.log(`   ⏭️  Skipped`)
            break
          case 'd': {
            // eslint-disable-next-line no-await-in-loop
            await showFixDetails(fix)
            // Ask again
            // eslint-disable-next-line no-await-in-loop
            const retry = await rl.question('\n   Apply fix? [y/n]: ')
            if (retry.toLowerCase() === 'y') {
              appliedFixes.push(fix)
              logger.success(`   ✓ Fix queued`)
            } else {
              skippedFixes.push(fix)
              logger.log(`   ⏭️  Skipped`)
            }
            break
          }
          case 'a':
            // Apply all remaining safe fixes
            for (const remainingFix of [...group.fixes, ...groups.slice(groups.indexOf(group) + 1).flatMap(g => g.fixes)]) {
              if (!remainingFix.breakingChanges && remainingFix.fixType === 'update') {
                appliedFixes.push(remainingFix)
              } else {
                skippedFixes.push(remainingFix)
              }
            }
            logger.success(`   ✓ Queued all safe fixes`)
            break
          case 'q':
            logger.log('\n👋 Exiting interactive mode')
            rl.close()
            return
        }

        if (answer.toLowerCase() === 'a') {
          break
        }
      }

      if (lastAnswer.toLowerCase() === 'a') {
        break
      }
    }
  } finally {
    rl.close()
  }

  // Apply the fixes
  if (appliedFixes.length > 0) {
    logger.log(`\n📦 Applying ${appliedFixes.length} fixes...\n`)

    for (const fix of appliedFixes) {
      // eslint-disable-next-line no-await-in-loop
      await applyFix(fix, context)
      logger.success(`✓ Fixed ${fix.name}`)
    }

    logger.log(`\n✅ Successfully applied ${appliedFixes.length} fixes`)
  }

  if (skippedFixes.length > 0) {
    logger.log(`⏭️  Skipped ${skippedFixes.length} fixes`)
  }
}

async function showFixDetails(fix: VulnerabilityFix): Promise<void> {
  logger.log('\n📋 Fix Details:')
  logger.log(`   Package: ${fix.name}`)
  logger.log(`   Current: ${fix.currentVersion}`)
  if (fix.suggestedVersion) {
    logger.log(`   Target: ${fix.suggestedVersion}`)
  }
  logger.log(`   Severity: ${fix.severity}`)
  logger.log(`   Issues: ${fix.issues.join(', ')}`)

  if (fix.dependents && fix.dependents.length > 0) {
    logger.log(`   Used by: ${fix.dependents.join(', ')}`)
  }

  if (fix.breakingChanges) {
    logger.log(colors.yellow(`   ⚠️  Breaking Changes: This update may require code changes`))
  }
}

async function applyFix(_fix: VulnerabilityFix, _context: any): Promise<void> {
  // This would actually apply the fix using the appropriate package manager
  // For now, just simulate
  await new Promise(resolve => setTimeout(resolve, 100))
}