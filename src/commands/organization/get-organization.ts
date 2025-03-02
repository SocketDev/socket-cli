import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import {
  getLastFiveOfApiToken,
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

export async function getOrganization(
  format: 'text' | 'json' | 'markdown' = 'text'
): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }
  await printOrganizationsFromToken(apiToken, format)
}

async function printOrganizationsFromToken(
  apiToken: string,
  format: 'text' | 'json' | 'markdown' = 'text'
) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching organizations...')

  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrganizations(),
    'looking up organizations'
  )

  if (!result.success) {
    handleUnsuccessfulApiResponse('getOrganizations', result, spinner)
    return
  }

  spinner.stop()

  const organizations = Object.values(result.data.organizations)
  const lastFiveOfApiToken = getLastFiveOfApiToken(apiToken)

  switch (format) {
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
        mw1 = Math.max(mw1, o.name.length)
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
          `- Name: ${colors.bold(o.name)}, ID: ${colors.bold(o.id)}, Plan: ${colors.bold(o.plan)}`
        )
      }
    }
  }
}
