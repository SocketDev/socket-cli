import fs from 'node:fs/promises'

import { Widgets } from 'blessed'
import contrib from 'blessed-contrib'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { handleApiCall, handleUnsuccessfulApiResponse } from '../../utils/api'
import { setupSdk } from '../../utils/sdk'

import type { CommandContext } from '../types.ts'

type FormattedData = {
  top_five_alert_types: { [key: string]: number }
  total_critical_alerts: { [key: string]: number }
  total_high_alerts: { [key: string]: number }
  total_medium_alerts: { [key: string]: number }
  total_low_alerts: { [key: string]: number }
  total_critical_added: { [key: string]: number }
  total_medium_added: { [key: string]: number }
  total_low_added: { [key: string]: number }
  total_high_added: { [key: string]: number }
  total_critical_prevented: { [key: string]: number }
  total_high_prevented: { [key: string]: number }
  total_medium_prevented: { [key: string]: number }
  total_low_prevented: { [key: string]: number }
}

// Note: This maps `new Date(date).getMonth()` to English three letters
export const Months = [
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

export async function runAnalytics(
  apiToken: string,
  input: CommandContext
): Promise<void> {
  if (input) {
    const spinner = new Spinner({ text: 'Fetching analytics data' }).start()
    if (input.scope === 'org') {
      await fetchOrgAnalyticsData(
        input.time,
        spinner,
        apiToken,
        input.outputJson,
        input.file
      )
    } else {
      if (input.repo) {
        await fetchRepoAnalyticsData(
          input.repo,
          input.time,
          spinner,
          apiToken,
          input.outputJson,
          input.file
        )
      }
    }
  }
}

function displayAnalyticsScreen(data: FormattedData): void {
  const screen = new Widgets.Screen({})
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

  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))
}

async function fetchOrgAnalyticsData(
  time: number,
  spinner: Spinner,
  apiToken: string,
  outputJson: boolean,
  filePath: string
): Promise<void> {
  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getOrgAnalytics(time.toString()),
    'fetching analytics data'
  )

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getOrgAnalytics', result, spinner)
  }

  spinner.stop()

  if (!result.data.length) {
    return console.log(
      'No analytics data is available for this organization yet.'
    )
  }
  const data = formatData(result.data, 'org')
  if (outputJson && !filePath) {
    console.log(result.data)
    return
  }
  if (filePath) {
    try {
      await fs.writeFile(filePath, JSON.stringify(result.data), 'utf8')
      console.log(`Data successfully written to ${filePath}`)
    } catch (e: any) {
      console.error(e)
    }
    return
  }
  return displayAnalyticsScreen(data)
}

async function fetchRepoAnalyticsData(
  repo: string,
  time: number,
  spinner: Spinner,
  apiToken: string,
  outputJson: boolean,
  filePath: string
): Promise<void> {
  const socketSdk = await setupSdk(apiToken)
  const result = await handleApiCall(
    socketSdk.getRepoAnalytics(repo, time.toString()),
    'fetching analytics data'
  )

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getRepoAnalytics', result, spinner)
  }

  spinner.stop()

  if (!result.data.length) {
    return console.log(
      'No analytics data is available for this organization yet.'
    )
  }
  const data = formatData(result.data, 'repo')
  if (outputJson && !filePath) {
    return console.log(result.data)
  }
  if (filePath) {
    try {
      await fs.writeFile(filePath, JSON.stringify(result.data), 'utf8')
      console.log(`Data successfully written to ${filePath}`)
    } catch (e: any) {
      console.error(e)
    }
    return
  }
  return displayAnalyticsScreen(data)
}

function formatData(
  data: { [key: string]: any }[],
  scope: string
): FormattedData {
  const formattedData = <Omit<FormattedData, 'top_five_alert_types'>>{}
  const sortedTopFiveAlerts: { [key: string]: number } = {}
  const totalTopAlerts: { [key: string]: number } = {}

  for (const metric of METRICS) {
    formattedData[metric] = {}
  }
  if (scope === 'org') {
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
  } else if (scope === 'repo') {
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
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .sort(({ 1: a }, { 1: b }) => b - a)
    .slice(0, 5)
  for (const { 0: key, 1: value } of topFiveAlertEntries) {
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
  grid: contrib.grid,
  screen: any,
  title: string,
  coords: number[],
  data: { [key: string]: number }
): void {
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
