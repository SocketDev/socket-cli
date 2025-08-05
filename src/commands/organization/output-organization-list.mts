import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { getVisibleTokenPrefix } from '../../utils/sdk.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputOrganizationList(
  result: CResult<SocketSdkSuccessResult<'getOrganizations'>['data']>,
  outputKind: OutputKind = 'text',
): Promise<void> {
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

  const organizations = Object.values(result.data.organizations)
  const visibleTokenPrefix = getVisibleTokenPrefix()

  switch (outputKind) {
    case 'markdown': {
      // | Syntax      | Description |
      // | ----------- | ----------- |
      // | Header      | Title       |
      // | Paragraph   | Text        |
      let mw1 = 4
      let mw2 = 2
      let mw3 = 4
      for (const o of organizations) {
        mw1 = Math.max(mw1, o.name?.length ?? 0)
        mw2 = Math.max(mw2, o.id.length)
        mw3 = Math.max(mw3, o.plan.length)
      }
      logger.log('# Organizations\n')
      logger.log(
        `List of organizations associated with your API token, starting with: ${colors.italic(visibleTokenPrefix)}\n`,
      )
      logger.log(
        `| Name${' '.repeat(mw1 - 4)} | ID${' '.repeat(mw2 - 2)} | Plan${' '.repeat(mw3 - 4)} |`,
      )
      logger.log(
        `| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`,
      )
      for (const o of organizations) {
        logger.log(
          `| ${(o.name || '').padEnd(mw1, ' ')} | ${(o.id || '').padEnd(mw2, ' ')} | ${(o.plan || '').padEnd(mw3, ' ')} |`,
        )
      }
      logger.log(
        `| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`,
      )
      return
    }
    default: {
      logger.log(
        `List of organizations associated with your API token, starting with: ${colors.italic(visibleTokenPrefix)}\n`,
      )
      // Just dump
      for (const o of organizations) {
        logger.log(
          `- Name: ${colors.bold(o.name ?? 'undefined')}, ID: ${colors.bold(o.id)}, Plan: ${colors.bold(o.plan)}`,
        )
      }
    }
  }
}
