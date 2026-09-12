import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdError, mdHeader, mdList } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

export type OptimizeData = {
  addedCount: number
  updatedCount: number
  pkgJsonChanged: boolean
  updatedInWorkspaces: number
  addedInWorkspaces: number
}

export function createActionMessage(
  verb: string,
  overrideCount: number,
  workspaceCount: number,
): string {
  return `${verb} ${overrideCount} Socket.dev optimized ${pluralize('override', { count: overrideCount })}${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', { count: workspaceCount })}` : ''}`
}

export function outputOptimizeMarkdown(data: OptimizeData): void {
  logger.log(mdHeader('Optimize Complete'))
  logger.log('')
  if (!data.pkgJsonChanged) {
    logger.log('No Socket.dev optimized overrides applied.')
    return
  }
  const changes = []
  if (data.updatedCount > 0) {
    changes.push(
      `**Updated**: ${data.updatedCount} ${pluralize('override', { count: data.updatedCount })}${data.updatedInWorkspaces ? ` in ${data.updatedInWorkspaces} ${pluralize('workspace', { count: data.updatedInWorkspaces })}` : ''}`,
    )
  }
  if (data.addedCount > 0) {
    changes.push(
      `**Added**: ${data.addedCount} ${pluralize('override', { count: data.addedCount })}${data.addedInWorkspaces ? ` in ${data.addedInWorkspaces} ${pluralize('workspace', { count: data.addedInWorkspaces })}` : ''}`,
    )
  }
  logger.log(mdList(changes))
  logger.success('Finished!')
}

export async function outputOptimizeResult(
  result: CResult<OptimizeData>,
  outputKind: OutputKind,
) {
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

    outputOptimizeMarkdown(result.data)
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  outputOptimizeText(result.data)
}

export function outputOptimizeText(data: OptimizeData): void {
  if (data.updatedCount > 0) {
    logger?.log(
      `${createActionMessage('Updated', data.updatedCount, data.updatedInWorkspaces)}.`,
    )
  }
  if (data.addedCount > 0) {
    logger?.log(
      createActionMessage('Added', data.addedCount, data.addedInWorkspaces),
    )
  }
  if (!data.pkgJsonChanged) {
    logger?.log('Scan complete. No Socket.dev optimized overrides applied.')
  }

  logger.log('')
  logger.success('Finished!')
  logger.log('')
}
