import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputOptimizeResult(
  result: CResult<{
    addedCount: number
    updatedCount: number
    pkgJsonChanged: boolean
    updatedInWorkspaces: number
    addedInWorkspaces: number
  }>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const data = result.data

  if (data.updatedCount > 0) {
    logger?.log(
      `${createActionMessage('Updated', data.updatedCount, data.updatedInWorkspaces)}${data.addedCount ? '.' : '🚀'}`,
    )
  }
  if (data.addedCount > 0) {
    logger?.log(
      `${createActionMessage('Added', data.addedCount, data.addedInWorkspaces)} 🚀`,
    )
  }
  if (!data.pkgJsonChanged) {
    logger?.log('Scan complete. No Socket.dev optimized overrides applied.')
  }

  logger.log('')
  logger.success('Finished!')
  logger.log('')
}

function createActionMessage(
  verb: string,
  overrideCount: number,
  workspaceCount: number,
): string {
  return `${verb} ${overrideCount} Socket.dev optimized ${pluralize('override', overrideCount)}${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', workspaceCount)}` : ''}`
}
