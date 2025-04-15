import open from 'open'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputCreateNewScan(
  data: SocketSdkReturnType<'CreateOrgFullScan'>['data'],
  outputKind: 'json' | 'markdown' | 'text',
  interactive: boolean
) {
  if (!data.id) {
    logger.fail('Did not receive a scan ID from the API...')
    process.exitCode = 1
  }

  if (outputKind === 'json') {
    const json = data.id
      ? { success: true, data }
      : { success: false, message: 'No scan ID received' }

    logger.log(JSON.stringify(json, null, 2))
    logger.log('')

    return
  }

  if (outputKind === 'markdown') {
    logger.log('# Create New Scan')
    logger.log('')
    if (data.id) {
      logger.log(
        `A [new Scan](${data.html_report_url}) was created with ID: ${data.id}`
      )
      logger.log('')
    } else {
      logger.log(
        `The server did not return a Scan ID while trying to create a new Scan. This could be an indication something went wrong.`
      )
    }
    logger.log('')
    return
  }

  const link = colors.underline(colors.cyan(`${data.html_report_url}`))
  logger.log(`Available at: ${link}`)

  if (
    interactive &&
    (await confirm({
      message: 'Would you like to open it in your browser?',
      default: false
    }))
  ) {
    await open(`${data.html_report_url}`)
  }
}
