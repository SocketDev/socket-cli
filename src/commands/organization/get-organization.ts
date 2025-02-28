import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

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
  const spinner = new Spinner({ text: 'Fetching organizations...' }).start()
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
      console.log(
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
      console.log('# Organizations\n')
      console.log(
        `List of organizations associated with your API key, ending with: ${colors.italic(lastFiveOfApiToken)}\n`
      )
      console.log(
        `| Name${' '.repeat(mw1 - 4)} | ID${' '.repeat(mw2 - 2)} | Plan${' '.repeat(mw3 - 4)} |`
      )
      console.log(
        `| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`
      )
      for (const o of organizations) {
        console.log(
          `| ${(o.name || '').padEnd(mw1, ' ')} | ${(o.id || '').padEnd(mw2, ' ')} | ${(o.plan || '').padEnd(mw3, ' ')} |`
        )
      }
      console.log(
        `| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`
      )
      return
    }
    default: {
      console.log(
        `List of organizations associated with your API key, ending with: ${colors.italic(lastFiveOfApiToken)}\n`
      )
      // Just dump
      for (const o of organizations) {
        console.log(
          `- Name: ${colors.bold(o.name)}, ID: ${colors.bold(o.id)}, Plan: ${colors.bold(o.plan)}`
        )
      }
    }
  }
}
