/**
 * Output formatter for patch download results.
 *
 * Displays download status for patches retrieved from Socket API.
 * Supports JSON and text output formats.
 *
 * Features:
 * - Summary of downloaded patches
 * - Summary of failed patches
 * - Error details for failures
 * - JSON output for automation
 */

import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { OUTPUT_JSON } from '../../constants/cli.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchDownloadResult } from './handle-patch-download.mts'
import type { CResult, OutputKind } from '../../types.mts'

type OutputOptions = {
  outputKind: OutputKind
}

/**
 * Output patch download results.
 */
export async function outputPatchDownloadResult(
  result: CResult<PatchDownloadResult>,
  { outputKind }: OutputOptions,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { downloaded, failed } = result.data

  logger.log('')

  // Show downloaded patches.
  if (downloaded.length) {
    logger.group(
      `Successfully downloaded ${downloaded.length} ${pluralize('patch', { count: downloaded.length })}:`,
    )
    for (const patch of downloaded) {
      logger.success(`${patch.purl} (${patch.uuid})`)
    }
    logger.groupEnd()
  }

  // Show failed patches.
  if (failed.length) {
    logger.log('')
    logger.group(
      `Failed to download ${failed.length} ${pluralize('patch', { count: failed.length })}:`,
    )
    for (const failure of failed) {
      logger.error(`${failure.uuid}: ${failure.error}`)
    }
    logger.groupEnd()
  }

  // Summary.
  logger.log('')
  if (failed.length) {
    logger.warn(
      `Patch download completed with ${failed.length} ${pluralize('failure', { count: failed.length })}`,
    )
  } else {
    logger.success('All patches downloaded successfully!')
  }
}
