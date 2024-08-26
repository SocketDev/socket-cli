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

  const data = formatData(result.data)

  if(outputJson){
    return console.log(data)
  }

  return displayAnalyticsScreen(data)
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

  const data = formatData(result.data)

  if(outputJson){
    return console.log(data)
  }

  return displayAnalyticsScreen(data)
}

const renderLineCharts = (grid: any, screen: any, title: string, coords: number[], data: FormattedAnalyticsData, label: string) => {
  const formattedDates = Object.keys(data).map(d => `${new Date(d).getMonth()+1}/${new Date(d).getDate()}`)

  // @ts-ignore
  const alertsCounts = Object.values(data).map(d => d[label])
  
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
    x: formattedDates,
    y: alertsCounts
  }

  line.setData([lineData])
}

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
  [key: string]: AnalyticsData
}

const formatData = (data: AnalyticsData[]) => {
  return data.reduce((acc: { [key: string]: any }, current) => {
    const formattedDate = new Date(current.created_at).toLocaleDateString()

    if (acc[formattedDate]) {
      acc[formattedDate].total_critical_alerts += current.total_critical_alerts
      acc[formattedDate].total_high_alerts += current.total_high_alerts
      acc[formattedDate].total_critical_added += current.total_critical_added
      acc[formattedDate].total_high_added += current.total_high_added
      acc[formattedDate].total_critical_prevented += current.total_critical_prevented
      acc[formattedDate].total_high_prevented += current.total_high_prevented
      acc[formattedDate].total_medium_prevented += current.total_medium_prevented
      acc[formattedDate].total_low_prevented += current.total_low_prevented
    } else {
      acc[formattedDate] = current
      acc[formattedDate].created_at = formattedDate
    }

    return acc
  }, {})
}

const displayAnalyticsScreen = (data: FormattedAnalyticsData) => {
  const screen = blessed.screen()
  // eslint-disable-next-line
  const grid = new contrib.grid({rows: 5, cols: 4, screen})

  renderLineCharts(grid, screen, 'Total critical alerts', [0,0,1,2], data, 'total_critical_alerts')
  renderLineCharts(grid, screen, 'Total high alerts', [0,2,1,2], data, 'total_high_alerts')
  renderLineCharts(grid, screen, 'Total critical alerts added to the main branch', [1,0,1,2], data, 'total_critical_added')
  renderLineCharts(grid, screen, 'Total high alerts added to the main branch', [1,2,1,2], data, 'total_high_added')
  renderLineCharts(grid, screen, 'Total critical alerts prevented from the main branch', [2,0,1,2], data, 'total_critical_prevented')
  renderLineCharts(grid, screen, 'Total high alerts prevented from the main branch', [2,2,1,2], data, 'total_high_prevented')
  renderLineCharts(grid, screen, 'Total medium alerts prevented from the main branch', [3,0,1,2], data, 'total_medium_prevented')
  renderLineCharts(grid, screen, 'Total low alerts prevented from the main branch', [3,2,1,2], data, 'total_low_prevented')

  const bar = grid.set(4, 0, 1, 2, contrib.bar,
      { label: 'Top 5 alert types'
      , barWidth: 10
      , barSpacing: 17
      , xOffset: 0
      , maxHeight: 9, barBgColor: 'magenta' })

   screen.append(bar) //must append before setting data
 
   const top5 = extractTop5Alerts(data)
   
   bar.setData(
      { titles: Object.keys(top5)
      , data: Object.values(top5)})

  screen.render()
    
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))
}

const extractTop5Alerts = (data: FormattedAnalyticsData) => {
  const allTop5Alerts = Object.values(data).map(d => d.top_five_alert_types)
  
  const aggTop5Alerts = allTop5Alerts.reduce((acc, current) => {
   const alertTypes = Object.keys(current)

   alertTypes.forEach(type => {
     if(!acc[type]){
      // @ts-ignore
       acc[type] = current[type]
     } else {
      // @ts-ignore
       if(acc[type] < current[type]){
        // @ts-ignore
         acc[type] = current[type]
       }
     }
   })
   
   return acc
  }, {})

  return Object.fromEntries(Object.entries(aggTop5Alerts).sort((a: [string, number], b: [string, number]) => b[1] - a[1]).slice(0,5))
}