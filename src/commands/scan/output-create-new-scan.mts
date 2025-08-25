import open from 'open'
import terminalLink from 'terminal-link'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type CreateNewScanOptions = {
  interactive?: boolean | undefined
  outputKind?: OutputKind | undefined
  spinner?: Spinner | undefined
}

export async function outputCreateNewScan(
  result: CResult<SocketSdkSuccessResult<'CreateOrgFullScan'>['data']>,
  options?: CreateNewScanOptions | undefined,
) {
  const {
    interactive = false,
    outputKind = 'text',
    // Lazily access constants.spinner.
    spinner = constants.spinner,
  } = { __proto__: null, ...options } as CreateNewScanOptions

  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  const wasSpinning = !!spinner?.isSpinning

  spinner?.stop()

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    if (wasSpinning) {
      spinner.start()
    }
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    if (wasSpinning) {
      spinner.start()
    }
    return
  }

  if (!result.data.id) {
    logger.fail('Did not receive a scan ID from the API.')
    process.exitCode = 1
  }

  if (outputKind === 'markdown') {
    logger.log('# Create New Scan')
    logger.log('')
    if (result.data.id) {
      logger.log(
        `A [new Scan](${result.data.html_report_url}) was created with ID: ${result.data.id}`,
      )
      logger.log('')
    } else {
      logger.log(
        `The server did not return a Scan ID while trying to create a new Scan. This could be an indication something went wrong.`,
      )
    }
    logger.log('')
    if (wasSpinning) {
      spinner.start()
    }
    return
  }

  logger.log('')
  logger.success('Scan completed successfully!')

  const htmlReportUrl = result.data.html_report_url
  if (htmlReportUrl) {
    logger.log(`View report at: ${terminalLink(htmlReportUrl, htmlReportUrl)}`)
  } else {
    logger.log('No report available.')
  }

  if (
    interactive &&
    (await confirm(
      {
        message: 'Would you like to open it in your browser?',
        default: false,
      },
      { spinner },
    ))
  ) {
    await open(`${result.data.html_report_url}`)
  }

  if (wasSpinning) {
    spinner.start()
  }
}
