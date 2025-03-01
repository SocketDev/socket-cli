import process from 'node:process'

// @ts-ignore
import ScreenWidget from 'blessed/lib/widgets/screen'
// @ts-ignore
import TableWidget from 'blessed-contrib/lib/widget/table'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { queryAPI } from '../../utils/api'

type ThreatResult = {
  createdAt: string
  description: string
  id: number
  locationHtmlUrl: string
  packageHtmlUrl: string
  purl: string
  removedAt: string
  threatType: string
}

export async function getThreatFeed({
  apiToken,
  direction,
  filter,
  outputJson,
  page,
  perPage
}: {
  apiToken: string
  outputJson: boolean
  perPage: number
  page: string
  direction: string
  filter: string
}): Promise<void> {
  const spinner = new Spinner()

  spinner.start('Looking up the threat feed')

  const formattedQueryParams = formatQueryParams({
    per_page: perPage,
    page,
    direction,
    filter
  }).join('&')
  const response = await queryAPI(
    `threat-feed?${formattedQueryParams}`,
    apiToken
  )
  const data = <{ results: ThreatResult[]; nextPage: string }>(
    await response.json()
  )

  spinner.stop()

  if (outputJson) {
    console.log(data)
    return
  }

  const screen = new ScreenWidget()

  const table = new TableWidget({
    keys: 'true',
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'magenta',
    interactive: 'true',
    label: 'Threat feed',
    width: '100%',
    height: '100%',
    border: {
      type: 'line',
      fg: 'cyan'
    },
    columnSpacing: 3, //in chars
    columnWidth: [9, 30, 10, 17, 13, 100] /*in chars*/
  })

  // allow control the table with the keyboard
  table.focus()

  screen.append(table)

  const formattedOutput = formatResults(data.results)

  table.setData({
    headers: [
      'Ecosystem',
      'Name',
      'Version',
      'Threat type',
      'Detected at',
      'Details'
    ],
    data: formattedOutput
  })

  screen.render()

  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))
}

function formatResults(data: ThreatResult[]) {
  return data.map(d => {
    const ecosystem = d.purl.split('pkg:')[1]!.split('/')[0]!
    const name = d.purl.split('/')[1]!.split('@')[0]!
    const version = d.purl.split('@')[1]!

    const timeStart = new Date(d.createdAt).getMilliseconds()
    const timeEnd = Date.now()

    const diff = getHourDiff(timeStart, timeEnd)
    const hourDiff =
      diff > 0
        ? `${diff} hours ago`
        : `${getMinDiff(timeStart, timeEnd)} minutes ago`

    return [
      ecosystem,
      decodeURIComponent(name),
      version,
      d.threatType,
      hourDiff,
      d.locationHtmlUrl
    ]
  })
}

function formatQueryParams(params: object) {
  return Object.entries(params).map(entry => `${entry[0]}=${entry[1]}`)
}

function getHourDiff(start: number, end: number) {
  return Math.floor((end - start) / 3600000)
}

function getMinDiff(start: number, end: number) {
  return Math.floor((end - start) / 60000)
}
