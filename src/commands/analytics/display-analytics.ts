import fs from 'node:fs/promises'

import { codeBlock } from 'common-tags'

import { logger } from '@socketsecurity/registry/lib/logger'

import { fetchOrgAnalyticsData } from './fetch-org-analytics'
import { fetchRepoAnalyticsData } from './fetch-repo-analytics'
import constants from '../../constants'
import { mdTableStringNumber } from '../../utils/markdown'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { Widgets } from 'blessed' // Note: Widgets does not seem to actually work as code :'(
import type { grid as ContribGrid } from 'blessed-contrib'

interface FormattedData {
  top_five_alert_types: Record<string, number>
  total_critical_alerts: Record<string, number>
  total_high_alerts: Record<string, number>
  total_medium_alerts: Record<string, number>
  total_low_alerts: Record<string, number>
  total_critical_added: Record<string, number>
  total_medium_added: Record<string, number>
  total_low_added: Record<string, number>
  total_high_added: Record<string, number>
  total_critical_prevented: Record<string, number>
  total_high_prevented: Record<string, number>
  total_medium_prevented: Record<string, number>
  total_low_prevented: Record<string, number>
}

const METRICS = [
  'total_critical_alerts',
  'total_high_alerts',
  'total_medium_alerts',
  'total_low_alerts',
  'total_critical_added',
  'total_medium_added',
  'total_low_added',
  'total_high_added',
  'total_critical_prevented',
  'total_high_prevented',
  'total_medium_prevented',
  'total_low_prevented'
] as const

// Note: This maps `new Date(date).getMonth()` to English three letters
const Months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

export async function displayAnalytics({
  filePath,
  outputKind,
  repo,
  scope,
  time
}: {
  scope: string
  time: number
  repo: string
  outputKind: 'json' | 'markdown' | 'print'
  filePath: string
}): Promise<void> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Fetching analytics data')

  let data:
    | undefined
    | SocketSdkReturnType<'getOrgAnalytics'>['data']
    | SocketSdkReturnType<'getRepoAnalytics'>['data']
  if (scope === 'org') {
    data = await fetchOrgAnalyticsData(time, spinner)
  } else if (repo) {
    data = await fetchRepoAnalyticsData(repo, time, spinner)
  }

  // A message should already have been printed if we have no data here
  if (!data) {
    return
  }

  if (outputKind === 'json') {
    const serialized = renderJson(data)
    if (!serialized) {
      return
    }

    if (filePath && filePath !== '-') {
      try {
        await fs.writeFile(filePath, serialized, 'utf8')
        logger.log(`Data successfully written to ${filePath}`)
      } catch (e) {
        process.exitCode = 1
        logger.fail('There was an error trying to write the json to disk')
        logger.error(e)
      }
    } else {
      logger.log(serialized)
    }
  } else {
    const fdata = scope === 'org' ? formatDataOrg(data) : formatDataRepo(data)

    if (outputKind === 'markdown') {
      const serialized = renderMarkdown(fdata, time, repo)

      if (filePath && filePath !== '-') {
        try {
          await fs.writeFile(filePath, serialized, 'utf8')
          logger.log(`Data successfully written to ${filePath}`)
        } catch (e) {
          logger.error(e)
        }
      } else {
        logger.log(serialized)
      }
    } else {
      displayAnalyticsScreen(fdata)
    }
  }
}

function renderJson(data: unknown): string | undefined {
  try {
    return JSON.stringify(data, null, 2)
  } catch (e) {
    process.exitCode = 1
    // This could be caused by circular references, which is an "us" problem
    logger.fail(
      'There was a problem converting the data set to JSON. Please try without --json or with --markdown'
    )
    return
  }
}

function renderMarkdown(
  data: FormattedData,
  days: number,
  repoSlug: string
): string {
  return codeBlock`
# Socket Alert Analytics

These are the Socket.dev stats are analytics for the ${repoSlug ? `${repoSlug} repo` : 'org'} of the past ${days} days

${[
  [
    'Total critical alerts',
    mdTableStringNumber('Date', 'Counts', data['total_critical_alerts'])
  ],
  [
    'Total high alerts',
    mdTableStringNumber('Date', 'Counts', data['total_high_alerts'])
  ],
  [
    'Total critical alerts added to the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_critical_added'])
  ],
  [
    'Total high alerts added to the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_high_added'])
  ],
  [
    'Total critical alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_critical_prevented'])
  ],
  [
    'Total high alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_high_prevented'])
  ],
  [
    'Total medium alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_medium_prevented'])
  ],
  [
    'Total low alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_low_prevented'])
  ]
]
  .map(
    ([title, table]) =>
      codeBlock`
## ${title}

${table}
`
  )
  .join('\n\n')}

## Top 5 alert types

${mdTableStringNumber('Name', 'Counts', data['top_five_alert_types'])}
`
}

function displayAnalyticsScreen(data: FormattedData): void {
  const ScreenWidget = require('blessed/lib/widgets/screen')
  // Lazily access constants.blessedOptions.
  const screen: Widgets.Screen = new ScreenWidget({
    ...constants.blessedOptions
  })
  const contrib = require('blessed-contrib')
  const grid = new contrib.grid({ rows: 5, cols: 4, screen })

  renderLineCharts(
    grid,
    screen,
    'Total critical alerts',
    [0, 0, 1, 2],
    data['total_critical_alerts']
  )
  renderLineCharts(
    grid,
    screen,
    'Total high alerts',
    [0, 2, 1, 2],
    data['total_high_alerts']
  )
  renderLineCharts(
    grid,
    screen,
    'Total critical alerts added to the main branch',
    [1, 0, 1, 2],
    data['total_critical_added']
  )
  renderLineCharts(
    grid,
    screen,
    'Total high alerts added to the main branch',
    [1, 2, 1, 2],
    data['total_high_added']
  )
  renderLineCharts(
    grid,
    screen,
    'Total critical alerts prevented from the main branch',
    [2, 0, 1, 2],
    data['total_critical_prevented']
  )
  renderLineCharts(
    grid,
    screen,
    'Total high alerts prevented from the main branch',
    [2, 2, 1, 2],
    data['total_high_prevented']
  )
  renderLineCharts(
    grid,
    screen,
    'Total medium alerts prevented from the main branch',
    [3, 0, 1, 2],
    data['total_medium_prevented']
  )
  renderLineCharts(
    grid,
    screen,
    'Total low alerts prevented from the main branch',
    [3, 2, 1, 2],
    data['total_low_prevented']
  )

  const bar = grid.set(4, 0, 1, 2, contrib.bar, {
    label: 'Top 5 alert types',
    barWidth: 10,
    barSpacing: 17,
    xOffset: 0,
    maxHeight: 9,
    barBgColor: 'magenta'
  })

  screen.append(bar) //must append before setting data

  bar.setData({
    titles: Object.keys(data.top_five_alert_types),
    data: Object.values(data.top_five_alert_types)
  })

  screen.render()
  // eslint-disable-next-line n/no-process-exit
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))
}

function formatDataRepo(
  data: SocketSdkReturnType<'getRepoAnalytics'>['data']
): FormattedData {
  const sortedTopFiveAlerts: Record<string, number> = {}
  const totalTopAlerts: Record<string, number> = {}

  const formattedData = {} as Omit<FormattedData, 'top_five_alert_types'>
  for (const metric of METRICS) {
    formattedData[metric] = {}
  }

  for (const entry of data) {
    const topFiveAlertTypes = entry['top_five_alert_types']
    for (const type of Object.keys(topFiveAlertTypes)) {
      const count = topFiveAlertTypes[type] ?? 0
      if (!totalTopAlerts[type]) {
        totalTopAlerts[type] = count
      } else if (count > (totalTopAlerts[type] ?? 0)) {
        totalTopAlerts[type] = count
      }
    }
  }
  for (const entry of data) {
    for (const metric of METRICS) {
      formattedData[metric]![formatDate(entry['created_at'])] = entry[metric]
    }
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .sort(([_keya, a], [_keyb, b]) => b - a)
    .slice(0, 5)
  for (const [key, value] of topFiveAlertEntries) {
    sortedTopFiveAlerts[key] = value
  }

  return {
    ...formattedData,
    top_five_alert_types: sortedTopFiveAlerts
  }
}

function formatDataOrg(
  data: SocketSdkReturnType<'getOrgAnalytics'>['data']
): FormattedData {
  const sortedTopFiveAlerts: Record<string, number> = {}
  const totalTopAlerts: Record<string, number> = {}

  const formattedData = {} as Omit<FormattedData, 'top_five_alert_types'>
  for (const metric of METRICS) {
    formattedData[metric] = {}
  }

  for (const entry of data) {
    const topFiveAlertTypes = entry['top_five_alert_types']
    for (const type of Object.keys(topFiveAlertTypes)) {
      const count = topFiveAlertTypes[type] ?? 0
      if (!totalTopAlerts[type]) {
        totalTopAlerts[type] = count
      } else {
        totalTopAlerts[type] += count
      }
    }
  }

  for (const metric of METRICS) {
    const formatted = formattedData[metric]
    for (const entry of data) {
      const date = formatDate(entry['created_at'])
      if (!formatted[date]) {
        formatted[date] = entry[metric]!
      } else {
        formatted[date] += entry[metric]!
      }
    }
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .sort(([_keya, a], [_keyb, b]) => b - a)
    .slice(0, 5)
  for (const [key, value] of topFiveAlertEntries) {
    sortedTopFiveAlerts[key] = value
  }

  return {
    ...formattedData,
    top_five_alert_types: sortedTopFiveAlerts
  }
}

function formatDate(date: string): string {
  return `${Months[new Date(date).getMonth()]} ${new Date(date).getDate()}`
}

function renderLineCharts(
  grid: ContribGrid,
  screen: Widgets.Screen,
  title: string,
  coords: number[],
  data: Record<string, number>
): void {
  const contrib = require('blessed-contrib')
  const line = grid.set(...coords, contrib.line, {
    style: { line: 'cyan', text: 'cyan', baseline: 'black' },
    xLabelPadding: 0,
    xPadding: 0,
    xOffset: 0,
    wholeNumbersOnly: true,
    legend: {
      width: 1
    },
    label: title
  })

  screen.append(line)

  const lineData = {
    x: Object.keys(data),
    y: Object.values(data)
  }

  line.setData([lineData])
}
