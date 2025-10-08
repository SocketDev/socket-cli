/** @fileoverview Consolidated package commands using DRY utilities with caching */

import { buildCommand, buildParentCommand } from '../../utils/command-builder.mts'
import { packageApi } from '../../utils/api-wrapper.mts'
import { simpleOutput } from '../../utils/simple-output.mts'
import { runStandardValidations } from '../../utils/common-validations.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { Spinner } from '../../utils/rich-progress.mts'
import { logger } from '@socketsecurity/registry/lib/logger'
import colors from 'yoctocolors-cjs'

// Parse package specifier (e.g., "lodash@4.17.21" or "npm/lodash/4.17.21")
function parsePackageSpec(spec: string): { ecosystem: string; name: string; version?: string } | null {
  // Format: ecosystem/name/version or ecosystem/name@version or name@version
  const slashParts = spec.split('/')

  if (slashParts.length === 3) {
    // ecosystem/name/version
    return {
      ecosystem: slashParts[0],
      name: slashParts[1],
      version: slashParts[2],
    }
  }

  if (slashParts.length === 2) {
    // ecosystem/name or ecosystem/name@version
    const atIndex = slashParts[1].indexOf('@')
    if (atIndex > 0) {
      return {
        ecosystem: slashParts[0],
        name: slashParts[1].slice(0, atIndex),
        version: slashParts[1].slice(atIndex + 1),
      }
    }
    return {
      ecosystem: slashParts[0],
      name: slashParts[1],
    }
  }

  // name@version or just name
  const atIndex = spec.lastIndexOf('@')
  if (atIndex > 0) {
    return {
      ecosystem: 'npm',
      name: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1),
    }
  }

  return {
    ecosystem: 'npm',
    name: spec,
  }
}

// Get package score
const cmdScore = buildCommand({
  name: 'score',
  description: 'Get security score for a package',
  args: '<package>',
  includeOutputFlags: true,
  flags: {
    ecosystem: {
      type: 'string',
      default: 'npm',
      description: 'Package ecosystem (npm, pypi, etc)',
    },
    'no-cache': {
      type: 'boolean',
      default: false,
      description: 'Skip cached data',
    },
    detailed: {
      type: 'boolean',
      default: false,
      description: 'Show detailed scoring breakdown',
    },
  },
  examples: [
    { command: 'lodash', description: 'Get score for latest lodash' },
    { command: 'lodash@4.17.21', description: 'Get score for specific version' },
    { command: 'pypi/flask/2.0.0', description: 'Get score for Python package' },
  ],
  handler: async ({ input, flags }) => {
    const spec = input[0]
    if (!spec) {
      logger.error('Package name is required')
      logger.log('Examples:')
      logger.log('  socket package score lodash')
      logger.log('  socket package score lodash@4.17.21')
      logger.log('  socket package score pypi/flask/2.0.0')
      process.exitCode = 1
      return
    }

    const { ecosystem: ecosystemFlag, 'no-cache': noCache, detailed, dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)

    // Parse package specifier
    const parsed = parsePackageSpec(spec)
    if (!parsed) {
      logger.error('Invalid package specifier')
      process.exitCode = 1
      return
    }

    const ecosystem = parsed.ecosystem || ecosystemFlag
    const { name } = parsed
    let { version } = parsed

    if (!runStandardValidations({
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    // Fetch latest version if not specified
    if (!version) {
      const spinner = new Spinner(`Fetching latest version of ${name}...`)
      if (!json && !markdown) spinner.start()

      // In a real implementation, we'd fetch the latest version from registry
      version = 'latest'

      spinner?.succeed(`Using version: ${version}`)
    }

    // Fetch package score with caching
    const result = await packageApi.score(ecosystem, name, version, { cache: !noCache })

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan(`Package Score: ${name}@${version}`))
        logger.log('')

        const score = data.score || 0
        const scoreColor = score >= 80 ? colors.green : score >= 60 ? colors.yellow : colors.red
        logger.log(`Overall Score: ${scoreColor(score + '/100')}`)

        if (detailed && data.breakdown) {
          logger.log('\nScore Breakdown:')
          logger.log(`  Supply Chain: ${data.breakdown.supply_chain || 0}/25`)
          logger.log(`  Maintenance: ${data.breakdown.maintenance || 0}/25`)
          logger.log(`  Vulnerability: ${data.breakdown.vulnerability || 0}/25`)
          logger.log(`  License: ${data.breakdown.license || 0}/25`)
        }

        if (data.issues && data.issues.length > 0) {
          logger.log(`\n${colors.red('Issues:')}`)
          for (const issue of data.issues.slice(0, 5)) {
            logger.log(`  • ${issue.severity}: ${issue.description}`)
          }
          if (data.issues.length > 5) {
            logger.log(`  ... and ${data.issues.length - 5} more`)
          }
        }

        if (data.recommendation) {
          logger.log(`\n💡 ${data.recommendation}`)
        }
      },
    })
  },
})

// Get package issues
const cmdIssues = buildCommand({
  name: 'issues',
  description: 'List security issues for a package',
  args: '<package>',
  includeOutputFlags: true,
  flags: {
    ecosystem: {
      type: 'string',
      default: 'npm',
      description: 'Package ecosystem',
    },
    severity: {
      type: 'string',
      description: 'Filter by severity (critical, high, medium, low)',
    },
    'no-cache': {
      type: 'boolean',
      default: false,
      description: 'Skip cached data',
    },
  },
  handler: async ({ input, flags }) => {
    const spec = input[0]
    if (!spec) {
      logger.error('Package name is required')
      process.exitCode = 1
      return
    }

    const { ecosystem: ecosystemFlag, severity, 'no-cache': noCache, dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)

    const parsed = parsePackageSpec(spec)
    if (!parsed) {
      logger.error('Invalid package specifier')
      process.exitCode = 1
      return
    }

    const ecosystem = parsed.ecosystem || ecosystemFlag
    const { name, version = 'latest' } = parsed

    if (!runStandardValidations({
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    const result = await packageApi.issues(ecosystem, name, version, { cache: !noCache })

    simpleOutput(result, outputKind, {
      text: data => {
        const issues = data.issues || []
        const filtered = severity
          ? issues.filter(i => i.severity === severity)
          : issues

        if (filtered.length === 0) {
          logger.success(`✅ No ${severity ? severity + ' ' : ''}issues found for ${name}@${version}`)
          return
        }

        logger.log(colors.cyan(`Issues for ${name}@${version}`))
        logger.log(`Found ${filtered.length} issue(s)\n`)

        // Group by severity
        const bySeverity: Record<string, any[]> = {}
        for (const issue of filtered) {
          const sev = issue.severity || 'unknown'
          if (!bySeverity[sev]) bySeverity[sev] = []
          bySeverity[sev].push(issue)
        }

        const severityOrder = ['critical', 'high', 'medium', 'low', 'unknown']
        for (const sev of severityOrder) {
          const issues = bySeverity[sev]
          if (!issues || issues.length === 0) continue

          const icon = sev === 'critical' ? '🔴' : sev === 'high' ? '🟠' : sev === 'medium' ? '🟡' : '⚪'
          logger.log(`${icon} ${colors.bold(sev.toUpperCase())} (${issues.length})`)

          for (const issue of issues.slice(0, 3)) {
            logger.log(`   ${issue.type}: ${issue.description}`)
            if (issue.cve) logger.log(`   CVE: ${issue.cve}`)
            if (issue.fix) logger.log(`   Fix: Update to ${issue.fix}`)
            logger.log('')
          }

          if (issues.length > 3) {
            logger.log(`   ... and ${issues.length - 3} more ${sev} issues\n`)
          }
        }
      },
    })
  },
})

// Package shallow analysis (quick check)
const cmdShallow = buildCommand({
  name: 'shallow',
  description: 'Quick security check for a package',
  args: '<package>',
  includeOutputFlags: true,
  handler: async ({ input, flags }) => {
    const spec = input[0]
    if (!spec) {
      logger.error('Package name is required')
      process.exitCode = 1
      return
    }

    const { dryRun, json, markdown } = flags
    const outputKind = getOutputKind(json, markdown)

    const parsed = parsePackageSpec(spec)
    if (!parsed) {
      logger.error('Invalid package specifier')
      process.exitCode = 1
      return
    }

    const { ecosystem = 'npm', name, version = 'latest' } = parsed

    if (!runStandardValidations({
      requireAuth: true,
      dryRun,
      outputKind,
    })) return

    // Quick parallel fetch of score and issues
    const spinner = new Spinner(`Analyzing ${name}@${version}...`)
    if (!json && !markdown) spinner.start()

    const [scoreResult, issuesResult] = await Promise.all([
      packageApi.score(ecosystem, name, version, { cache: true }),
      packageApi.issues(ecosystem, name, version, { cache: true }),
    ])

    spinner?.stop()

    if (!scoreResult.ok || !issuesResult.ok) {
      logger.error('Failed to analyze package')
      process.exitCode = 1
      return
    }

    const score = scoreResult.data.score || 0
    const issues = issuesResult.data.issues || []
    const critical = issues.filter(i => i.severity === 'critical').length
    const high = issues.filter(i => i.severity === 'high').length

    // Quick assessment
    const status = score >= 80 && critical === 0 && high === 0 ? 'safe' :
                   score >= 60 && critical === 0 ? 'caution' : 'unsafe'

    simpleOutput({ ok: true, data: { status, score, issues: { critical, high } } }, outputKind, {
      text: data => {
        const icon = data.status === 'safe' ? '✅' : data.status === 'caution' ? '⚠️' : '❌'
        const color = data.status === 'safe' ? colors.green : data.status === 'caution' ? colors.yellow : colors.red

        logger.log(`${icon} ${color(data.status.toUpperCase())}: ${name}@${version}`)
        logger.log(`   Score: ${data.score}/100`)
        if (data.issues.critical > 0) logger.log(`   🔴 Critical: ${data.issues.critical}`)
        if (data.issues.high > 0) logger.log(`   🟠 High: ${data.issues.high}`)
      },
    })
  },
})

// Export parent command with subcommands
export const cmdPackage = buildParentCommand({
  name: 'package',
  description: 'Analyze package security',
  subcommands: {
    score: cmdScore,
    issues: cmdIssues,
    shallow: cmdShallow,
  },
  defaultSubcommand: 'score',
})

// Export individual commands for compatibility
export { cmdScore as cmdPackageScore }
export { cmdIssues as cmdPackageIssues }
export { cmdShallow as cmdPackageShallow }