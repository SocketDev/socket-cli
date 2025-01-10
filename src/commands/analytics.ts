import fs from 'node:fs/promises'

// @ts-ignore
import ScreenWidget from 'blessed/lib/widgets/screen'
// @ts-ignore
import GridLayout from 'blessed-contrib/lib/layout/grid'
// @ts-ignore
import BarChart from 'blessed-contrib/lib/widget/charts/bar'
// @ts-ignore
import LineChart from 'blessed-contrib/lib/widget/charts/line'
import meow from 'meow'
import colors from 'yoctocolors-cjs'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { commonFlags, outputFlags } from '../flags'
import {
  handleApiCall,
  handleUnsuccessfulApiResponse
} from '../utils/api-helpers'
import { AuthError, InputError } from '../utils/errors'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const analytics: CliSubcommand = {
  description: `Look up analytics data \n
  Default parameters are set to show the organization-level analytics over the last 7 days.`,
  async run(argv, importMeta, { parentName }) {
    const name = parentName + ' analytics'

    const input = setupCommand(name, analytics.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if (!apiKey) {
        throw new AuthError(
          'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
        )
      }
      const spinner = new Spinner({ text: 'Fetching analytics data' }).start()
      if (input.scope === 'org') {
        await fetchOrgAnalyticsData(
          input.time,
          spinner,
          apiKey,
          input.outputJson,
          input.file
        )
      } else {
        if (input.repo) {
          await fetchRepoAnalyticsData(
            input.repo,
            input.time,
            spinner,
            apiKey,
            input.outputJson,
            input.file
          )
        }
      }
    }
  }
}

const analyticsFlags = {
  scope: {
    type: 'string',
    shortFlag: 's',
    default: 'org',
    description: "Scope of the analytics data - either 'org' or 'repo'"
  },
  time: {
    type: 'number',
    shortFlag: 't',
    default: 7,
    description: 'Time filter - either 7, 30 or 90'
  },
  repo: {
    type: 'string',
    shortFlag: 'r',
    default: '',
    description: 'Name of the repository'
  },
  file: {
    type: 'string',
    shortFlag: 'f',
    default: '',
    description: 'Path to a local file to save the output'
  }
}

// Internal functions

type CommandContext = {
  scope: string
  time: number
  repo: string
  outputJson: boolean
  file: string
}

function setupCommand(
  name: string,
  description: string,
  argv: readonly string[],
  importMeta: ImportMeta
): void | CommandContext {
  const flags: { [key: string]: any } = {
    ...commonFlags,
    ...outputFlags,
    ...analyticsFlags
  }
  const cli = meow(
    `
    Usage
      $ ${name} --scope=<scope> --time=<time filter>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} --scope=org --time=7
      $ ${name} --scope=org --time=30
      $ ${name} --scope=repo --repo=test-repo --time=30
  `,
    {
      argv,
      description,
      importMeta,
      flags
    }
  )
  const { repo, scope, time } = cli.flags
  if (scope !== 'org' && scope !== 'repo') {
    throw new InputError("The scope must either be 'org' or 'repo'")
  }
  if (time !== 7 && time !== 30 && time !== 90) {
    throw new InputError('The time filter must either be 7, 30 or 90')
  }
  let showHelp = cli.flags['help']
  if (scope === 'repo' && !repo) {
    showHelp = true
    console.error(
      `${colors.bgRed(colors.white('Input error'))}: Please provide a repository name when using the repository scope.`
    )
  }
  if (showHelp) {
    cli.showHelp()
    return
  }
  return <CommandContext>{
    scope,
    time,
    repo,
    outputJson: cli.flags['json'],
    file: cli.flags['file']
  }
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
]

async function fetchOrgAnalyticsData(
  time: number,
  spinner: Spinner,
  apiKey: string,
  outputJson: boolean,
  filePath: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
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

const months = [
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
]

const formatDate = (date: string) => {
  return `${months[new Date(date).getMonth()]} ${new Date(date).getDate()}`
}

const formatData = (data: any, scope: string) => {
  let formattedData, sortedTopFiveAlerts

  if (scope === 'org') {
    const topFiveAlerts = data.map(
      (d: { [k: string]: any }) => d['top_five_alert_types']
    )

    const totalTopAlerts: { [key: string]: number } = topFiveAlerts.reduce(
      (acc: { [k: string]: number }, current: { [key: string]: number }) => {
        const alertTypes = Object.keys(current)
        alertTypes.map((type: string) => {
          if (!acc[type]) {
            acc[type] = current[type]!
          } else {
            acc[type] += current[type]!
          }
          return acc
        })
        return acc
      },
      {} as { [k: string]: number }
    )

    sortedTopFiveAlerts = Object.entries(totalTopAlerts)
      .sort(({ 1: a }, { 1: b }) => b - a)
      .slice(0, 5)
      .reduce(
        (r, { 0: k, 1: v }) => {
          r[k] = v
          return r
        },
        {} as typeof totalTopAlerts
      )

    const formatData = (label: string) => {
      return data.reduce(
        (acc: { [k: string]: number }, current: { [key: string]: any }) => {
          const date: string = formatDate(current['created_at'])
          if (!acc[date]) {
            acc[date] = current[label]!
          } else {
            acc[date] += current[label]!
          }
          return acc
        },
        {}
      )
    }

    formattedData = METRICS.reduce(
      (acc, current: string) => {
        acc[current] = formatData(current)
        return acc
      },
      {} as { [k: string]: number }
    )
  } else if (scope === 'repo') {
    const topAlerts: { [key: string]: number } = data.reduce(
      (acc: { [key: string]: number }, current: { [key: string]: any }) => {
        const alertTypes = Object.keys(current['top_five_alert_types'])
        alertTypes.map(type => {
          if (!acc[type]) {
            acc[type] = current['top_five_alert_types'][type]
          } else {
            if (current['top_five_alert_types'][type] > (acc[type] || 0)) {
              acc[type] = current['top_five_alert_types'][type]
            }
          }
          return acc
        })
        return acc
      },
      {} as { [key: string]: number }
    )

    sortedTopFiveAlerts = Object.entries(topAlerts)
      .sort(({ 1: a }, { 1: b }) => b - a)
      .slice(0, 5)
      .reduce(
        (r, { 0: k, 1: v }) => {
          r[k] = v
          return r
        },
        {} as typeof topAlerts
      )

    formattedData = data.reduce(
      (acc: any, current: { [key: string]: any }) => {
        METRICS.forEach((m: string) => {
          if (!acc[m]) {
            acc[m] = {}
          }
          acc[m][formatDate(current['created_at'])] = current[m]
          return acc
        })
        return acc
      },
      {} as { [k: string]: number }
    )
  }

  return { ...formattedData, top_five_alert_types: sortedTopFiveAlerts }
}

async function fetchRepoAnalyticsData(
  repo: string,
  time: number,
  spinner: Spinner,
  apiKey: string,
  outputJson: boolean,
  filePath: string
): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
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

const displayAnalyticsScreen = (data: any) => {
  const screen = new ScreenWidget()
  const grid = new GridLayout({ rows: 5, cols: 4, screen })

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

  const bar = grid.set(4, 0, 1, 2, BarChart, {
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

const renderLineCharts = (
  grid: any,
  screen: any,
  title: string,
  coords: number[],
  data: { [key: string]: number }
) => {
  const line = grid.set(...coords, LineChart, {
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
