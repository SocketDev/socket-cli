import open from 'open'
import terminalLink from 'terminal-link'

import { getSpinner } from '@socketsecurity/lib/constants/process'
import { logger } from '@socketsecurity/lib/logger'
import { confirm } from '@socketsecurity/lib/prompts'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'
import type { Spinner } from '@socketsecurity/lib/spinner'
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
    spinner = getSpinner(),
  } = { __proto__: null, ...options } as CreateNewScanOptions

  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  const wasSpinning = !!spinner?.isSpinning

  spinner?.stop()

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    if (wasSpinning) {
      spinner?.start()
    }
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    if (wasSpinning) {
      spinner?.start()
    }
    return
  }

  if (!result.data.id) {
    logger.fail('Did not receive a scan ID from the API.')
    process.exitCode = 1
  }

  if (outputKind === 'markdown') {
    logger.log(mdHeader('Create New Scan'))
    logger.log('')
    if (result.data.id) {
      logger.log(
        `A [new Scan](${result.data.html_report_url}) was created with ID: ${result.data.id}`,
      )
      logger.log('')
    } else {
      logger.log(
        'The server did not return a Scan ID while trying to create a new Scan. This could be an indication something went wrong.',
      )
    }
    logger.log('')
    if (wasSpinning) {
      spinner?.start()
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
    (await confirm({
      message: 'Would you like to open it in your browser?',
      default: false,
    }))
  ) {
    await open(`${result.data.html_report_url}`)
  }

  if (wasSpinning) {
    spinner?.start()
  }
}
