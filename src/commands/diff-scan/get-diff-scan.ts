import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

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
  const spinnerText = 'Getting diff scan... \n'
  const spinner = new Spinner({ text: spinnerText }).start()

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
        ? console.error(err)
        : console.log(`Data successfully written to ${file}`)
    })
    return
  }

  if (outputJson) {
    console.log(`\n Diff scan result: \n`)
    console.log(
      util.inspect(data, { showHidden: false, depth: null, colors: true })
    )
    console.log(
      `\n View this diff scan in the Socket dashboard: ${colors.cyan((data as any)?.['diff_report_url'])}`
    )
    return
  }

  console.log('Diff scan result:')
  console.log(data)
  console.log(
    `\n 📝 To display the detailed report in the terminal, use the --json flag \n`
  )
  console.log(
    `\n View this diff scan in the Socket dashboard: ${colors.cyan((data as any)?.['diff_report_url'])}`
  )
}
