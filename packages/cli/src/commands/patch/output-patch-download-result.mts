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

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

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
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { downloaded, failed } = result.data

  getDefaultLogger().log('')

  // Show downloaded patches.
  if (downloaded.length) {
    getDefaultLogger().group(
      `Successfully downloaded ${downloaded.length} ${pluralize('patch', { count: downloaded.length })}:`,
    )
    for (const patch of downloaded) {
      getDefaultLogger().success(`${patch.purl} (${patch.uuid})`)
    }
    getDefaultLogger().groupEnd()
  }

  // Show failed patches.
  if (failed.length) {
    getDefaultLogger().log('')
    getDefaultLogger().group(
      `Failed to download ${failed.length} ${pluralize('patch', { count: failed.length })}:`,
    )
    for (const failure of failed) {
      getDefaultLogger().error(`${failure.uuid}: ${failure.error}`)
    }
    getDefaultLogger().groupEnd()
  }

  // Summary.
  getDefaultLogger().log('')
  if (failed.length) {
    getDefaultLogger().warn(
      `Patch download completed with ${failed.length} ${pluralize('failure', { count: failed.length })}`,
    )
  } else {
    getDefaultLogger().success('All patches downloaded successfully!')
  }
}
