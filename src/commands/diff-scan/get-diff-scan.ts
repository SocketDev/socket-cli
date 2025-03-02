import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleAPIError, queryAPI } from '../../utils/api'

export async function getDiffScan(
  {
    after,
    before,
    file,
    orgSlug,
    outputJson
  }: {
    outputJson: boolean
    outputMarkdown: boolean
    before: string
    after: string
    preview: boolean
    orgSlug: string
    file: string
  },
  apiToken: string
): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Getting diff scan...')

  const response = await queryAPI(
    `${orgSlug}/full-scans/diff?before=${before}&after=${after}&preview`,
    apiToken
  )
  const data = await response.json()

  if (!response.ok) {
    const err = await handleAPIError(response.status)
    spinner.errorAndStop(
      `${colors.bgRed(colors.white(response.statusText))}: ${err}`
    )
    return
  }

  spinner.stop()

  if (file && !outputJson) {
    fs.writeFile(file, JSON.stringify(data), err => {
      err
        ? logger.error(err)
        : logger.log(`Data successfully written to ${file}`)
    })
    return
  }

  if (outputJson) {
    logger.log(`\n Diff scan result: \n`)
    logger.log(
      util.inspect(data, { showHidden: false, depth: null, colors: true })
    )
    logger.log(
      `\n View this diff scan in the Socket dashboard: ${colors.cyan((data as any)?.['diff_report_url'])}`
    )
    return
  }

  logger.log('Diff scan result:')
  logger.log(data)
  logger.log(
    `\n 📝 To display the detailed report in the terminal, use the --json flag \n`
  )
  logger.log(
    `\n View this diff scan in the Socket dashboard: ${colors.cyan((data as any)?.['diff_report_url'])}`
  )
}
