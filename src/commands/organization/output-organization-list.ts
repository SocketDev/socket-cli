import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { getLastFiveOfApiToken } from '../../utils/api'
import { getDefaultToken } from '../../utils/sdk'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputOrganizationList(
  data: SocketSdkReturnType<'getOrganizations'>['data'],
  outputKind: OutputKind = 'text'
): Promise<void> {
  const organizations = Object.values(data.organizations)
  const apiToken = getDefaultToken()
  const lastFiveOfApiToken = getLastFiveOfApiToken(apiToken ?? '?????')

  switch (outputKind) {
    case 'json': {
      logger.log(
        JSON.stringify(
          organizations.map(o => ({
            name: o.name,
            id: o.id,
            plan: o.plan
          })),
          null,
          2
        )
      )
      return
    }
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
        `List of organizations associated with your API key, ending with: ${colors.italic(lastFiveOfApiToken)}\n`
      )
      logger.log(
        `| Name${' '.repeat(mw1 - 4)} | ID${' '.repeat(mw2 - 2)} | Plan${' '.repeat(mw3 - 4)} |`
      )
      logger.log(
        `| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`
      )
      for (const o of organizations) {
        logger.log(
          `| ${(o.name || '').padEnd(mw1, ' ')} | ${(o.id || '').padEnd(mw2, ' ')} | ${(o.plan || '').padEnd(mw3, ' ')} |`
        )
      }
      logger.log(
        `| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`
      )
      return
    }
    default: {
      logger.log(
        `List of organizations associated with your API key, ending with: ${colors.italic(lastFiveOfApiToken)}\n`
      )
      // Just dump
      for (const o of organizations) {
        logger.log(
          `- Name: ${colors.bold(o.name ?? 'undefined')}, ID: ${colors.bold(o.id)}, Plan: ${colors.bold(o.plan)}`
        )
      }
    }
  }
}
