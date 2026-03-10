/**
 * Dry-run output utilities for Socket CLI commands.
 *
 * Provides standardized output formatting for dry-run mode that shows users
 * what actions WOULD be performed without actually executing them.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_LABEL } from '../../constants/cli.mts'

const logger = getDefaultLogger()

export interface DryRunAction {
  type: 'create' | 'delete' | 'execute' | 'fetch' | 'modify' | 'upload' | 'write'
  description: string
  target?: string
  details?: Record<string, unknown>
}

export interface DryRunPreview {
  summary: string
  actions: DryRunAction[]
  wouldSucceed?: boolean
}

/**
 * Format and output a dry-run preview.
 */
export function outputDryRunPreview(preview: DryRunPreview): void {
  logger.log('')
  logger.log(`${DRY_RUN_LABEL}: ${preview.summary}`)
  logger.log('')

  if (preview.actions.length === 0) {
    logger.log('  No actions would be performed.')
  } else {
    logger.log('  Actions that would be performed:')
    for (const action of preview.actions) {
      const targetStr = action.target ? ` → ${action.target}` : ''
      logger.log(`    - [${action.type}] ${action.description}${targetStr}`)
      if (action.details) {
        for (const [key, value] of Object.entries(action.details)) {
          logger.log(`        ${key}: ${JSON.stringify(value)}`)
        }
      }
    }
  }

  logger.log('')
  if (preview.wouldSucceed !== undefined) {
    logger.log(
      preview.wouldSucceed
        ? '  Would complete successfully.'
        : '  Would fail (see details above).',
    )
  }
  logger.log('')
  logger.log('  Run without --dry-run to execute these actions.')
  logger.log('')
}

/**
 * Output a simple dry-run message for commands that just fetch/display data.
 * These commands don't really need dry-run since they're read-only.
 */
export function outputDryRunFetch(resourceName: string): void {
  logger.log('')
  logger.log(`${DRY_RUN_LABEL}: Would fetch ${resourceName}`)
  logger.log('')
  logger.log('  This is a read-only operation that does not modify any data.')
  logger.log('  Run without --dry-run to fetch and display the data.')
  logger.log('')
}

/**
 * Output dry-run for commands that execute external tools.
 */
export function outputDryRunExecute(
  command: string,
  args: string[],
  description?: string,
): void {
  logger.log('')
  logger.log(
    `${DRY_RUN_LABEL}: Would execute ${description || 'external command'}`,
  )
  logger.log('')
  logger.log(`  Command: ${command}`)
  if (args.length > 0) {
    logger.log(`  Arguments: ${args.join(' ')}`)
  }
  logger.log('')
  logger.log('  Run without --dry-run to execute this command.')
  logger.log('')
}

/**
 * Output dry-run for file write operations.
 */
export function outputDryRunWrite(
  filePath: string,
  description: string,
  changes?: string[],
): void {
  logger.log('')
  logger.log(`${DRY_RUN_LABEL}: Would ${description}`)
  logger.log('')
  logger.log(`  Target file: ${filePath}`)
  if (changes && changes.length > 0) {
    logger.log('  Changes:')
    for (const change of changes) {
      logger.log(`    - ${change}`)
    }
  }
  logger.log('')
  logger.log('  Run without --dry-run to apply these changes.')
  logger.log('')
}

/**
 * Output dry-run for API upload operations.
 */
export function outputDryRunUpload(
  resourceType: string,
  details: Record<string, unknown>,
): void {
  logger.log('')
  logger.log(`${DRY_RUN_LABEL}: Would upload ${resourceType}`)
  logger.log('')
  logger.log('  Details:')
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'object' && value !== null) {
      logger.log(`    ${key}:`)
      for (const [subKey, subValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        logger.log(`      ${subKey}: ${JSON.stringify(subValue)}`)
      }
    } else {
      logger.log(`    ${key}: ${JSON.stringify(value)}`)
    }
  }
  logger.log('')
  logger.log('  Run without --dry-run to perform this upload.')
  logger.log('')
}

/**
 * Output dry-run for delete operations.
 */
export function outputDryRunDelete(
  resourceType: string,
  identifier: string,
): void {
  logger.log('')
  logger.log(`${DRY_RUN_LABEL}: Would delete ${resourceType}`)
  logger.log('')
  logger.log(`  Target: ${identifier}`)
  logger.log('')
  logger.log('  This action cannot be undone.')
  logger.log('  Run without --dry-run to perform this deletion.')
  logger.log('')
}
