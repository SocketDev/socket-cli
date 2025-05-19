import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputDiffScan(
  result: CResult<SocketSdkReturnType<'GetOrgDiffScan'>['data']>,
  {
    depth,
    file,
    outputKind,
  }: {
    depth: number
    file: string
    outputKind: OutputKind
  },
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      logger.log(serializeResultJson(result))
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const dashboardUrl = result.data.diff_report_url
  const dashboardMessage = dashboardUrl
    ? `\n View this diff scan in the Socket dashboard: ${colors.cyan(dashboardUrl)}`
    : ''

  // When forcing json, or dumping to file, serialize to string such that it
  // won't get truncated. The only way to dump the full raw JSON to stdout is
  // to use `--json --file -` (the dash is a standard notation for stdout)
  if (outputKind === 'json' || file) {
    const json = serializeResultJson(result)

    if (file && file !== '-') {
      logger.info(`Writing json to \`${file}\``)
      fs.writeFile(file, JSON.stringify(result, null, 2), err => {
        if (err) {
          logger.fail(`Writing to \`${file}\` failed...`)
          logger.error(err)
        } else {
          logger.success(`Data successfully written to \`${file}\``)
        }
        logger.info(dashboardMessage)
      })
    } else {
      // Note: only the .log will go to stdout
      logger.success(`\n Diff scan result: \n`)
      logger.log(json)
      logger.info(dashboardMessage)
    }

    return
  }

  // In this case neither the --json nor the --file flag was passed
  // Dump the JSON to CLI and let NodeJS deal with truncation

  logger.success('Diff scan result:')
  logger.log(
    util.inspect(result, {
      showHidden: false,
      depth: depth > 0 ? depth : null,
      colors: true,
      maxArrayLength: null,
    }),
  )
  logger.info(
    `\n 📝 To display the detailed report in the terminal, use the --json flag \n`,
  )
  logger.log(dashboardMessage)
}
