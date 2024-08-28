// @ts-nocheck
// @ts-ignore
import blessed from 'blessed'
import contrib from 'blessed-contrib'
import meow from 'meow'
import ora from 'ora'

import { outputFlags } from '../flags'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../utils/api-helpers'
import { AuthError, InputError } from '../utils/errors'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { Ora } from "ora"
import chalk from 'chalk'

export const analytics: CliSubcommand = {
  description: `Look up analytics data \n
  Default parameters are set to show the organization-level analytics over the last 7 days.`,
  async run (argv, importMeta, { parentName }) {
    const name = parentName + ' analytics'

    const input = setupCommand(name, analytics.description, argv, importMeta)
    if (input) {
      const apiKey = getDefaultKey()
      if(!apiKey){
        throw new AuthError("User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.")
      }
      const spinner = ora('Fetching analytics data').start()
      if (input.scope === 'org') {
        await fetchOrgAnalyticsData(input.time, spinner, apiKey, input.outputJson)
      } else {
        if (input.repo) {
          await fetchRepoAnalyticsData(input.repo, input.time, spinner, apiKey, input.outputJson)
        }
      }
    }
  }
}

const analyticsFlags: { [key: string]: any } = {
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
    description: "Name of the repository"
  },
}

// Internal functions

type CommandContext = {
  scope: string
  time: number
  repo: string
  outputJson: boolean
}

function setupCommand (name: string, description: string, argv: readonly string[], importMeta: ImportMeta): void|CommandContext {
  const flags: { [key: string]: any } = {
    ...outputFlags,
    ...analyticsFlags
  }

  const cli = meow(`
    Usage
      $ ${name} --scope=<scope> --time=<time filter>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} --scope=org --time=7
      $ ${name} --scope=org --time=30
      $ ${name} --scope=repo --repo=test-repo --time=30
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    json: outputJson,
    scope, 
    time,
    repo
  } = cli.flags

  if (scope !== 'org' && scope !== 'repo') {
    throw new InputError("The scope must either be 'org' or 'repo'")
  }

  if (time !== 7 && time !== 30 && time !== 90) {
    throw new InputError('The time filter must either be 7, 30 or 90')
  }

  if(scope === 'repo' && !repo){
    console.error(
      `${chalk.bgRed.white('Input error')}: Please provide a repository name when using the repository scope. \n`
    )
    cli.showHelp()
    return
  }

  return <CommandContext>{
    scope, time, repo, outputJson
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

type AnalyticsData = {
  id: number,
  created_at: string
  repository_id: string
  organization_id: number
  repository_name: string
  total_critical_alerts: number
  total_high_alerts: number
  total_medium_alerts: number
  total_low_alerts: number
  total_critical_added: number
  total_high_added: number
  total_medium_added: number
  total_low_added: number
  total_critical_prevented: number
  total_high_prevented: number
  total_medium_prevented: number
  total_low_prevented: number
  top_five_alert_types: {
    [key: string]: number
  }
}

type FormattedAnalyticsData = {
  [key: string]: {
    [key: string]: number | {
      [key: string]: number
    }
  }
}

async function fetchOrgAnalyticsData (time: number, spinner: Ora, apiKey: string, outputJson: boolean): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(socketSdk.getOrgAnalytics(time.toString()), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getOrgAnalytics', result, spinner)
  }

  spinner.stop()

  if(!result.data.length){
    return console.log('No analytics data is available for this organization yet.')
  }

  const data = formatData(result.data, 'org')

  console.log(data)

  if(outputJson){
    return console.log(result.data)
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

const formatData = (data: AnalyticsData[], scope: string) => {
  let formattedData, sortedTopFivealerts

  if(scope === 'org'){
    const topFiveAlerts = data.map(d => d.top_five_alert_types || {})

    const totalTopAlerts = topFiveAlerts.reduce((acc, current: {[key: string]: number}) => {
      const alertTypes = Object.keys(current)
      alertTypes.map((type: string) => {
        if (!acc[type]) {
          acc[type] = current[type]
        } else {
          acc[type] += current[type]
        }
        return acc
      })
      return acc
    }, {} as { [k: string]: any })

  
    sortedTopFivealerts = Object.entries(totalTopAlerts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .reduce((r, [k, v]) => ({ ...r, [k]: v }), {})
  
    const formatData = (label: string) => {
      return data.reduce((acc, current) => {
        const date: string = formatDate(current.created_at)
        if (!acc[date]) {
          acc[date] = current[label]
        } else {
          acc[date] += current[label]
        }
        return acc
      }, {} as { [k: string]: number })
    }
  
    formattedData = METRICS.reduce((acc, current: string) => {
      acc[current] = formatData(current)
      return acc
    }, {} as { [k: string]: any })

  } else if (scope === 'repo'){

    const topAlerts = data.reduce((acc, current) => {
      const alertTypes = Object.keys(current.top_five_alert_types)
      alertTypes.map(type => {
        if (!acc[type]) {
          acc[type] = current.top_five_alert_types[type]
        } else {
          if (current.top_five_alert_types[type] > acc[type]) {
            acc[type] = current.top_five_alert_types[type]
          }
        }
        return acc
      })
      return acc
    }, {} as {[key: string]: number})

    sortedTopFivealerts = Object.entries(topAlerts)
    .sort(([, a]: [string, number], [, b]: [string, number]) => b - a)
    .slice(0, 5)
    .reduce((r, [k, v]) => ({ ...r, [k]: v }), {})

  formattedData = data.reduce((acc, current) => {
    METRICS.forEach((m: string) => {
      if (!acc[m]) {
        acc[m] = {}
      }
      acc[m][formatDate(current.created_at)] = current[m]
      return acc
    })
    return acc
  }, {} as { [k: string]: any })
  }

  return {...formattedData, top_five_alert_types: sortedTopFivealerts}
}

async function fetchRepoAnalyticsData (repo: string, time: number, spinner: Ora, apiKey: string, outputJson: boolean): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(socketSdk.getRepoAnalytics(repo, time.toString()), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getRepoAnalytics', result, spinner)
  }
  spinner.stop()

  if(!result.data.length){
    return console.log('No analytics data is available for this organization yet.')
  }

  const data = formatData(result.data, 'repo')

  if(outputJson){
    return console.log(result.data)
  }

  return displayAnalyticsScreen(data)
}

const displayAnalyticsScreen = (data: FormattedAnalyticsData) => {
  const screen = blessed.screen()
  // eslint-disable-next-line
  const grid = new contrib.grid({rows: 5, cols: 4, screen})

  renderLineCharts(grid, screen, 'Total critical alerts', [0,0,1,2], data['total_critical_alerts'])
  renderLineCharts(grid, screen, 'Total high alerts', [0,2,1,2], data['total_high_alerts'])
  renderLineCharts(grid, screen, 'Total critical alerts added to the main branch', [1,0,1,2], data['total_critical_added'])
  renderLineCharts(grid, screen, 'Total high alerts added to the main branch', [1,2,1,2], data['total_high_added'])
  renderLineCharts(grid, screen, 'Total critical alerts prevented from the main branch', [2,0,1,2], data['total_critical_prevented'])
  renderLineCharts(grid, screen, 'Total high alerts prevented from the main branch', [2,2,1,2], data['total_high_prevented'])
  renderLineCharts(grid, screen, 'Total medium alerts prevented from the main branch', [3,0,1,2], data['total_medium_prevented'])
  renderLineCharts(grid, screen, 'Total low alerts prevented from the main branch', [3,2,1,2], data['total_low_prevented'])

  const bar = grid.set(4, 0, 1, 2, contrib.bar,
      { label: 'Top 5 alert types'
      , barWidth: 10
      , barSpacing: 17
      , xOffset: 0
      , maxHeight: 9, barBgColor: 'magenta' })

   screen.append(bar) //must append before setting data
   
   bar.setData(
      { titles: Object.keys(data.top_five_alert_types)
      , data: Object.values(data.top_five_alert_types)})

  screen.render()
    
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))
}

const renderLineCharts = (grid: any, screen: any, title: string, coords: number[], data: {[key: string]: number}) => {  
  const line = grid.set(...coords, contrib.line,
    { style:
      { line: "cyan", 
        text: "cyan", 
        baseline: "black"
      }, 
      xLabelPadding: 0, 
      xPadding: 0,
      xOffset: 0,
      wholeNumbersOnly: true,
      legend: {
        width: 1
      }, 
      label: title
    }
  )

  screen.append(line)

  const lineData = {
    x: Object.keys(data),
    y: Object.values(data)
  }

  line.setData([lineData])
}