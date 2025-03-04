import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { SocketSdkReturnType } from '@socketsecurity/sdk'

import constants from '../../constants'
import { handleAPIError, handleApiCall, queryAPI } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken } from '../../utils/sdk'

export async function getDiffScan({
  after,
  before,
  depth,
  file,
  orgSlug,
  outputJson
}: {
  after: string
  before: string
  depth: number
  file: string
  orgSlug: string
  outputJson: boolean
}): Promise<void> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  await getDiffScanWithToken({
    after,
    before,
    depth,
    file,
    orgSlug,
    outputJson,
    apiToken
  })
}
export async function getDiffScanWithToken({
  after,
  apiToken,
  before,
  depth,
  file,
  orgSlug,
  outputJson
}: {
  after: string
  apiToken: string
  depth: number
  before: string
  file: string
  orgSlug: string
  outputJson: boolean
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Getting diff scan...')

  const response = await queryAPI(
    `orgs/${orgSlug}/full-scans/diff?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
    apiToken
  )

  if (!response.ok) {
    const err = await handleAPIError(response.status)
    spinner.errorAndStop(
      `${colors.bgRed(colors.white(response.statusText))}: ${err}`
    )
    return
  }

  const result = await handleApiCall(
    (await response.json()) as Promise<
      SocketSdkReturnType<'GetOrgDiffScan'>['data']
    >,
    'Deserializing json'
  )

  spinner.stop()

  const dashboardUrl = (result as any)?.['diff_report_url']
  const dashboardMessage = dashboardUrl
    ? `\n View this diff scan in the Socket dashboard: ${colors.cyan(dashboardUrl)}`
    : ''

  // When forcing json, or dumping to file, serialize to string such that it
  // won't get truncated. The only way to dump the full raw JSON to stdout is
  // to use `--json --file -` (the dash is a standard notation for stdout)
  if (outputJson || file) {
    let json
    try {
      json = JSON.stringify(result, null, 2)
    } catch (e) {
      process.exitCode = 1
      // Most likely caused by a circular reference (or OOM)
      logger.error('There was a problem converting the data to JSON')
      logger.error(e)
      return
    }

    if (file && file !== '-') {
      logger.log(`Writing json to \`${file}\``)
      fs.writeFile(file, JSON.stringify(result, null, 2), err => {
        if (err) {
          logger.error(`Writing to \`${file}\` failed...`)
          logger.error(err)
        } else {
          logger.log(`Data successfully written to \`${file}\``)
        }
        logger.error(dashboardMessage)
      })
    } else {
      // TODO: expose different method for writing to stderr when simply dodging stdout
      logger.error(`\n Diff scan result: \n`)
      logger.log(json)
      logger.error(dashboardMessage)
    }

    return
  }

  // In this case neither the --json nor the --file flag was passed
  // Dump the JSON to CLI and let NodeJS deal with truncation

  logger.log('Diff scan result:')
  logger.log(
    util.inspect(result, {
      showHidden: false,
      depth: depth > 0 ? depth : null,
      colors: true,
      maxArrayLength: null
    })
  )
  logger.log(
    `\n 📝 To display the detailed report in the terminal, use the --json flag \n`
  )
  logger.log(dashboardMessage)
}
