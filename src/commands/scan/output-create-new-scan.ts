import process from 'node:process'
import readline from 'node:readline/promises'

import open from 'open'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputCreateNewScan(
  data: SocketSdkReturnType<'CreateOrgFullScan'>['data']
) {
  const link = colors.underline(colors.cyan(`${data.html_report_url}`))
  logger.log(`Available at: ${link}`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const answer = await rl.question(
    'Would you like to open it in your browser? (y/n)'
  )

  if (answer.toLowerCase() === 'y') {
    await open(`${data.html_report_url}`)
  }
  rl.close()
}
