import open from 'open'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

export async function outputCreateNewScan(
  data: SocketSdkReturnType<'CreateOrgFullScan'>['data']
) {
  const link = colors.underline(colors.cyan(`${data.html_report_url}`))
  logger.log(`Available at: ${link}`)

  if (
    await confirm({
      message: 'Would you like to open it in your browser?',
      default: false
    })
  ) {
    await open(`${data.html_report_url}`)
  }
}
