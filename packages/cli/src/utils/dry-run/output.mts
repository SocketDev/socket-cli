/**
 * Dry-run output utilities for Socket CLI commands.
 *
 * Dry-run previews are contextual output — they describe what WOULD
 * happen, they are not the command's payload. Per the stream discipline
 * rule (CLAUDE.md: SHARED STANDARDS), context belongs on stderr. This
 * keeps `command --json --dry-run` pipe-safe and also keeps dry-run
 * previews visible to humans running `command > file` (where stderr
 * still goes to the terminal).
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_LABEL } from '../../constants/cli.mts'

const logger = getDefaultLogger()

function out(message: string): void {
  logger.error(message)
}

export interface DryRunAction {
  type:
    | 'create'
    | 'delete'
    | 'execute'
    | 'fetch'
    | 'modify'
    | 'upload'
    | 'write'
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
  out('')
  out(`${DRY_RUN_LABEL}: ${preview.summary}`)
  out('')

  if (!preview.actions.length) {
    out('  No actions would be performed.')
  } else {
    out('  Actions that would be performed:')
    for (const action of preview.actions) {
      const targetStr = action.target ? ` → ${action.target}` : ''
      out(`    - [${action.type}] ${action.description}${targetStr}`)
      if (action.details) {
        for (const [key, value] of Object.entries(action.details)) {
          out(`        ${key}: ${JSON.stringify(value)}`)
        }
      }
    }
  }

  out('')
  if (preview.wouldSucceed !== undefined) {
    out(
      preview.wouldSucceed
        ? '  Would complete successfully.'
        : '  Would fail (see details above).',
    )
  }
  out('')
  out('  Run without --dry-run to execute these actions.')
  out('')
}

/**
 * Output a simple dry-run message for commands that just fetch/display data.
 * These commands don't really need dry-run since they're read-only,
 * but showing computed query parameters helps users verify their input.
 */
export function outputDryRunFetch(
  resourceName: string,
  queryParams?: Record<string, string | number | boolean | undefined>,
): void {
  out('')
  out(`${DRY_RUN_LABEL}: Would fetch ${resourceName}`)
  out('')

  if (queryParams && Object.keys(queryParams).length > 0) {
    out('  Query parameters:')
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== '') {
        out(`    ${key}: ${value}`)
      }
    }
    out('')
  }

  out('  This is a read-only operation that does not modify any data.')
  out('  Run without --dry-run to fetch and display the data.')
  out('')
}

/**
 * Output dry-run for commands that execute external tools.
 */
export function outputDryRunExecute(
  command: string,
  args: string[],
  description?: string,
): void {
  out('')
  out(
    `${DRY_RUN_LABEL}: Would execute ${description || 'external command'}`,
  )
  out('')
  out(`  Command: ${command}`)
  if (args.length > 0) {
    out(`  Arguments: ${args.join(' ')}`)
  }
  out('')
  out('  Run without --dry-run to execute this command.')
  out('')
}

/**
 * Output dry-run for file write operations.
 */
export function outputDryRunWrite(
  filePath: string,
  description: string,
  changes?: string[],
): void {
  out('')
  out(`${DRY_RUN_LABEL}: Would ${description}`)
  out('')
  out(`  Target file: ${filePath}`)
  if (changes && changes.length > 0) {
    out('  Changes:')
    for (const change of changes) {
      out(`    - ${change}`)
    }
  }
  out('')
  out('  Run without --dry-run to apply these changes.')
  out('')
}

/**
 * Output dry-run for API upload operations.
 */
export function outputDryRunUpload(
  resourceType: string,
  details: Record<string, unknown>,
): void {
  out('')
  out(`${DRY_RUN_LABEL}: Would upload ${resourceType}`)
  out('')
  out('  Details:')
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'object' && value !== null) {
      out(`    ${key}:`)
      for (const [subKey, subValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        out(`      ${subKey}: ${JSON.stringify(subValue)}`)
      }
    } else {
      out(`    ${key}: ${JSON.stringify(value)}`)
    }
  }
  out('')
  out('  Run without --dry-run to perform this upload.')
  out('')
}

/**
 * Output dry-run for delete operations.
 */
export function outputDryRunDelete(
  resourceType: string,
  identifier: string,
): void {
  out('')
  out(`${DRY_RUN_LABEL}: Would delete ${resourceType}`)
  out('')
  out(`  Target: ${identifier}`)
  out('')
  out('  This action cannot be undone.')
  out('  Run without --dry-run to perform this deletion.')
  out('')
}
