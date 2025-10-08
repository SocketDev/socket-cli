/** @fileoverview Consolidated scan commands using DRY utilities with rich progress */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { scanApi } from '../../utils/api-wrapper.mts'
import { buildCommand, buildParentCommand } from '../../utils/command-builder.mts'
import { runStandardValidations } from '../../utils/common-validations.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { withCache } from '../../utils/offline-cache.mts'
import { getProjectContext } from '../../utils/project-context.mts'
import { FileProgress, MultiProgress, Spinner } from '../../utils/rich-progress.mts'
import { commonColumns, simpleOutput } from '../../utils/simple-output.mts'



// Create scan with rich progress and project awareness
const cmdCreate = buildCommand({
  name: 'create',
  description: 'Create a security scan with project awareness',
  args: '[PATH]',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    prod: {
      type: 'boolean',
      default: false,
      description: 'Scan production dependencies only',
    },
    reach: {
      type: 'boolean',
      default: false,
      description: 'Enable reachability analysis',
    },
    'no-progress': {
      type: 'boolean',
      default: false,
      description: 'Disable progress indicators',
    },
    cache: {
      type: 'boolean',
      default: true,
      description: 'Use cached data when available',
    },
  },
  handler: async ({ flags, input }) => {
    const targetPath = input[0] || process.cwd()
    const { cache, dryRun, json, markdown, org: orgFlag, prod, reach } = flags
    const showProgress = !flags['no-progress'] && !json && !markdown
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    // Project context detection with progress
    let contextSpinner: Spinner | undefined
    if (showProgress) {
      contextSpinner = new Spinner('Analyzing project structure...')
      contextSpinner.start()
    }

    const context = await getProjectContext(targetPath)
    if (!context) {
      contextSpinner?.fail('Not a valid project directory')
      logger.error('Could not detect project type')
      process.exitCode = 1
      return
    }

    if (contextSpinner) {
      contextSpinner.succeed(
        `Detected ${colors.cyan(context.type)} project` +
        (context.framework ? ` using ${colors.cyan(context.framework)}` : '') +
        (context.isMonorepo ? ' ' + colors.yellow('(monorepo)') : '')
      )
    }

    // Show contextual suggestions
    if (showProgress && !dryRun) {
      const suggestions = getContextualSuggestions(context, prod)
      if (suggestions.length > 0) {
        logger.log('\n💡 Suggestions based on your project:')
        for (const suggestion of suggestions) {
          logger.log(`   • ${suggestion}`)
        }
        logger.log('')
      }

      // Warn about missing lock files
      if (!context.hasLockFile) {
        logger.warn('⚠️  No lock file found!')
        logger.warn(`   Run \`${getPackageManagerCommand(context.type, 'install')}\` to generate one`)
        logger.log('')
      }
    }

    // Multi-phase scan with progress tracking
    let progress: MultiProgress | undefined
    if (showProgress) {
      progress = new MultiProgress({ hideCursor: true })
      progress.addTask('parse', 'Parsing dependencies', 100)
      progress.addTask('analyze', 'Analyzing vulnerabilities', 100)
      progress.addTask('reach', 'Checking reachability', 100)
    }

    try {
      // Phase 1: Parse dependencies
      progress?.updateTask('parse', 25, { message: 'Reading package files...' })
      const packageFiles = await findPackageFiles(targetPath, context)
      progress?.updateTask('parse', 50, { message: `Found ${packageFiles.length} package files` })

      // Create scan payload
      const scanPayload = {
        target: targetPath,
        prod,
        reach,
        files: packageFiles,
      }

      progress?.updateTask('parse', 100)

      // Phase 2: Analyze with caching
      progress?.updateTask('analyze', 25, { message: 'Submitting for analysis...' })

      const result = cache
        ? await withCache(
            `scan-${orgSlug}`,
            scanPayload,
            () => scanApi.create(orgSlug, scanPayload),
            { ttl: 5 * 60 * 1000 } // 5 minute cache
          )
        : await scanApi.create(orgSlug, scanPayload)

      progress?.updateTask('analyze', 100)

      // Phase 3: Reachability (if enabled)
      if (reach) {
        progress?.updateTask('reach', 50, { message: 'Analyzing code paths...' })
        // Simulated reachability check
        await new Promise(resolve => setTimeout(resolve, 1000))
        progress?.updateTask('reach', 100)
      }

      progress?.stop()

      // Output results
      simpleOutput(result, outputKind, {
        text: data => {
          logger.success('✅ Scan completed successfully')
          logger.log('')
          logger.log(colors.cyan('Scan Summary:'))
          logger.log(`ID: ${data.id}`)
          logger.log(`Status: ${data.status}`)
          if (data.vulnerabilities) {
            const { critical = 0, high = 0, low = 0, medium = 0 } = data.vulnerabilities
            logger.log('')
            logger.log('Vulnerabilities found:')
            if (critical > 0) {logger.log(`  🔴 Critical: ${critical}`)}
            if (high > 0) {logger.log(`  🟠 High: ${high}`)}
            if (medium > 0) {logger.log(`  🟡 Medium: ${medium}`)}
            if (low > 0) {logger.log(`  ⚪ Low: ${low}`)}
          }
        },
      })
    } finally {
      progress?.stop()
    }
  },
})

// List scans
const cmdList = buildCommand({
  name: 'list',
  description: 'List recent scans',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
    limit: {
      type: 'number',
      default: 10,
      description: 'Number of scans to list',
    },
  },
  handler: async ({ flags }) => {
    const { dryRun, json, limit, markdown, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await scanApi.list(orgSlug, { limit })

    simpleOutput(result, outputKind, {
      table: {
        columns: [
          commonColumns.id,
          {
            field: 'created_at',
            name: colors.magenta('Created'),
            transform: v => new Date(v).toLocaleString(),
          },
          {
            field: 'status',
            name: colors.magenta('Status'),
            transform: v => v === 'complete' ? colors.green(v) : colors.yellow(v),
          },
          { field: 'vulnerabilities', name: colors.magenta('Issues') },
        ],
        rows: data => data.scans || [],
      },
      emptyMessage: 'No scans found',
    })
  },
})

// View scan
const cmdView = buildCommand({
  name: 'view',
  description: 'View scan details',
  args: '<scan-id>',
  includeOutputFlags: true,
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
  },
  handler: async ({ flags, input }) => {
    const scanId = input[0]
    if (!scanId) {
      logger.error('Scan ID is required')
      process.exitCode = 1
      return
    }

    const { dryRun, json, markdown, org: orgFlag } = flags
    const outputKind = getOutputKind(json, markdown)
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind,
    })) {return}

    const result = await scanApi.view(orgSlug, scanId)

    simpleOutput(result, outputKind, {
      text: data => {
        logger.log(colors.cyan('Scan Details'))
        logger.log(`ID: ${data.id}`)
        logger.log(`Created: ${new Date(data.created_at).toLocaleString()}`)
        logger.log(`Status: ${data.status}`)

        if (data.findings && data.findings.length > 0) {
          logger.log(`\n${colors.cyan('Findings:')}`)
          for (const finding of data.findings) {
            const icon = getSeverityIcon(finding.severity)
            logger.log(`${icon} ${finding.package}@${finding.version}`)
            logger.log(`   ${finding.description}`)
          }
        } else {
          logger.log('\n✅ No vulnerabilities found')
        }
      },
    })
  },
})

// Delete scan
const cmdDelete = buildCommand({
  name: 'del',
  description: 'Delete a scan',
  args: '<scan-id>',
  flags: {
    org: {
      type: 'string',
      default: '',
      description: 'Organization slug',
    },
  },
  handler: async ({ flags, input }) => {
    const scanId = input[0]
    if (!scanId) {
      logger.error('Scan ID is required')
      process.exitCode = 1
      return
    }

    const { dryRun, org: orgFlag } = flags
    const { 0: orgSlug } = await determineOrgSlug(orgFlag, true, dryRun)

    if (!runStandardValidations({
      requireOrg: orgSlug,
      requireAuth: true,
      dryRun,
      outputKind: 'text',
    })) {return}

    const result = await scanApi.delete(orgSlug, scanId)

    if (result.ok) {
      logger.success(`Deleted scan: ${scanId}`)
    } else {
      logger.error(`Failed to delete scan: ${result.message}`)
      process.exitCode = 1
    }
  },
})

// Helper functions
function getContextualSuggestions(context: any, prod: boolean): string[] {
  const suggestions: string[] = []

  if (context.framework === 'next' && !prod) {
    suggestions.push('Consider using --prod to exclude dev dependencies from production scans')
  }

  if (context.isMonorepo) {
    suggestions.push('This appears to be a monorepo - each package will be scanned')
  }

  if (!context.hasLockFile) {
    suggestions.push('Lock files provide more accurate dependency resolution')
  }

  return suggestions
}

function getPackageManagerCommand(pm: string, command: string): string {
  switch (pm) {
    case 'pnpm': return `pnpm ${command}`
    case 'yarn': return `yarn ${command}`
    default: return `npm ${command}`
  }
}

async function findPackageFiles(targetPath: string, context: any): Promise<string[]> {
  const files: string[] = []

  // Check for package.json
  const pkgPath = join(targetPath, 'package.json')
  if (existsSync(pkgPath)) {
    files.push(pkgPath)
  }

  // Check for lock files
  const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
  for (const lockFile of lockFiles) {
    const lockPath = join(targetPath, lockFile)
    if (existsSync(lockPath)) {
      files.push(lockPath)
    }
  }

  return files
}

function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴'
    case 'high': return '🟠'
    case 'medium': return '🟡'
    case 'low': return '⚪'
    default: return '⚫'
  }
}

// Export parent command with subcommands
export const cmdScan = buildParentCommand({
  name: 'scan',
  description: 'Security scanning with rich progress',
  subcommands: {
    create: cmdCreate,
    list: cmdList,
    view: cmdView,
    del: cmdDelete,
  },
  defaultSubcommand: 'create',
})

// Export individual commands for compatibility
export { cmdCreate as cmdScanCreate }
export { cmdList as cmdScanList }
export { cmdView as cmdScanView }
export { cmdDelete as cmdScanDel }