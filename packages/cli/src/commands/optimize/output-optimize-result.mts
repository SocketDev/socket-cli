import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdError, mdHeader, mdList } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

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
  const logger = getDefaultLogger()

  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }

  if (outputKind === 'markdown') {
    if (!result.ok) {
      logger.log(mdError(result.message, result.cause))
      return
    }

    const data = result.data
    logger.log(mdHeader('Optimize Complete'))
    logger.log('')

    if (data.pkgJsonChanged) {
      const changes = []
      if (data.updatedCount > 0) {
        const updatedText = `**Updated**: ${data.updatedCount} ${pluralize('override', { count: data.updatedCount })}${data.updatedInWorkspaces ? ` in ${data.updatedInWorkspaces} ${pluralize('workspace', { count: data.updatedInWorkspaces })}` : ''}`
        changes.push(updatedText)
      }
      if (data.addedCount > 0) {
        const addedText = `**Added**: ${data.addedCount} ${pluralize('override', { count: data.addedCount })}${data.addedInWorkspaces ? ` in ${data.addedInWorkspaces} ${pluralize('workspace', { count: data.addedInWorkspaces })}` : ''}`
        changes.push(addedText)
      }
      logger.log(mdList(changes))
      logger.log('\n✓ Finished!')
    } else {
      logger.log('No Socket.dev optimized overrides applied.')
    }
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
  return `${verb} ${overrideCount} Socket.dev optimized ${pluralize('override', { count: overrideCount })}${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', { count: workspaceCount })}` : ''}`
}
