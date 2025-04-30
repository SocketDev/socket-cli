import open from 'open'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputCreateNewScan(
  result: CResult<SocketSdkReturnType<'CreateOrgFullScan'>['data']>,
  outputKind: OutputKind,
  interactive: boolean
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

  if (!result.data.id) {
    logger.fail('Did not receive a scan ID from the API...')
    process.exitCode = 1
  }

  if (outputKind === 'markdown') {
    logger.log('# Create New Scan')
    logger.log('')
    if (result.data.id) {
      logger.log(
        `A [new Scan](${result.data.html_report_url}) was created with ID: ${result.data.id}`
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

  const link = colors.underline(colors.cyan(`${result.data.html_report_url}`))
  logger.log(`Available at: ${link}`)

  if (
    interactive &&
    (await confirm({
      message: 'Would you like to open it in your browser?',
      default: false
    }))
  ) {
    await open(`${result.data.html_report_url}`)
  }
}
