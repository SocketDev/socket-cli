import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputDiffScan(
  result: SocketSdkReturnType<'GetOrgDiffScan'>['data'],
  {
    depth,
    file,
    outputKind
  }: {
    depth: number
    file: string
    outputKind: 'json' | 'markdown' | 'text'
  }
): Promise<void> {
  const dashboardUrl = result.diff_report_url
  const dashboardMessage = dashboardUrl
    ? `\n View this diff scan in the Socket dashboard: ${colors.cyan(dashboardUrl)}`
    : ''

  // When forcing json, or dumping to file, serialize to string such that it
  // won't get truncated. The only way to dump the full raw JSON to stdout is
  // to use `--json --file -` (the dash is a standard notation for stdout)
  if (outputKind === 'json' || file) {
    let json
    try {
      json = JSON.stringify(result, null, 2)
    } catch (e) {
      process.exitCode = 1
      // Most likely caused by a circular reference (or OOM)
      logger.fail('There was a problem converting the data to JSON')
      logger.error(e)
      return
    }

    if (file && file !== '-') {
      logger.log(`Writing json to \`${file}\``)
      fs.writeFile(file, JSON.stringify(result, null, 2), err => {
        if (err) {
          logger.fail(`Writing to \`${file}\` failed...`)
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
