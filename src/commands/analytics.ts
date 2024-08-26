// @ts-ignore
import blessed from 'blessed'
import contrib from 'blessed-contrib'
import meow from 'meow'
import ora from 'ora'

import { outputFlags, validationFlags } from '../flags'
import { handleApiCall, handleUnsuccessfulApiResponse } from '../utils/api-helpers'
import { AuthError, InputError } from '../utils/errors'
import { printFlagList } from '../utils/formatting'
import { getDefaultKey, setupSdk } from '../utils/sdk'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { Ora } from "ora"

export const analytics: CliSubcommand = {
  description: 'Look up analytics data',
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

// Internal functions

type CommandContext = {
  scope: string
  time: string
  repo: string | undefined
  outputJson: boolean
}

function setupCommand (name: string, description: string, argv: readonly string[], importMeta: ImportMeta): void|CommandContext {
  const flags: { [key: string]: any } = {
    ...outputFlags,
    ...validationFlags,
  }

  const cli = meow(`
    Usage
      $ ${name} <scope> <time>

    Options
      ${printFlagList(flags, 6)}

    Examples
      $ ${name} org 7
      $ ${name} org 30
  `, {
    argv,
    description,
    importMeta,
    flags
  })

  const {
    json: outputJson
  } = cli.flags

  const scope = cli.input[0]

  if (!scope) {
    throw new InputError('Please provide a scope to get analytics data')
  }

  if (!cli.input.length) {
    throw new InputError('Please provide a scope and a time to get analytics data')
  }

  if (scope && !['org', 'repo'].includes(scope)) {
    throw new InputError("The scope must either be 'scope' or 'repo'")
  }

  const repo = scope === 'repo' ? cli.input[1] : undefined

  const time = scope === 'repo' ? cli.input[2] : cli.input[1]

  if (!time) {
    throw new InputError('Please provide a time to get analytics data')
  }

  if (time && !['7', '30', '60'].includes(time)) {
    throw new InputError('The time filter must either be 7, 30 or 60')
  }

  return <CommandContext>{
      scope, time, repo, outputJson
  }
}

async function fetchOrgAnalyticsData (time: string, spinner: Ora, apiKey: string, outputJson: boolean): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(socketSdk.getOrgAnalytics(time), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getOrgAnalytics', result, spinner)
  }

  spinner.stop()

  const data = result.data.reduce((acc: { [key: string]: any }, current) => {
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

  if(outputJson){
    return console.log(data)
  }

  const screen = blessed.screen()
  // eslint-disable-next-line
  const grid = new contrib.grid({rows: 4, cols: 4, screen})

  renderLineCharts(grid, screen, 'Total critical alerts', [0,0,1,2], data, 'total_critical_alerts')
  renderLineCharts(grid, screen, 'Total high alerts', [0,2,1,2], data, 'total_high_alerts')
  renderLineCharts(grid, screen, 'Total critical alerts added to main', [1,0,1,2], data, 'total_critical_added')
  renderLineCharts(grid, screen, 'Total high alerts added to main', [1,2,1,2], data, 'total_high_added')
  renderLineCharts(grid, screen, 'Total critical alerts prevented from main', [2,0,1,2], data, 'total_critical_prevented')
  renderLineCharts(grid, screen, 'Total high alerts prevented from main', [2,2,1,2], data, 'total_high_prevented')

  const bar = grid.set(3, 0, 1, 2, contrib.bar,
      { label: 'Top 5 alert types'
      , barWidth: 10
      , barSpacing: 17
      , xOffset: 0
      , maxHeight: 9, barBgColor: 'magenta' })

   screen.append(bar) //must append before setting data

   const top5AlertTypes = Object.values(data)[0].top_five_alert_types
   
   bar.setData(
      { titles: Object.keys(top5AlertTypes)
      , data: Object.values(top5AlertTypes)})

  screen.render()
    
  screen.key(['escape', 'q', 'C-c'], function() {
    return process.exit(0);
  })
}

async function fetchRepoAnalyticsData (repo: string, time: string, spinner: Ora, apiKey: string, outputJson: boolean): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(socketSdk.getRepoAnalytics(repo, time), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getRepoAnalytics', result, spinner)
  }
  spinner.stop()

  const data = result.data.reduce((acc: { [key: string]: any }, current) => {
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

  if(outputJson){
    return console.log(data)
  }

  const screen = blessed.screen()
  // eslint-disable-next-line
  const grid = new contrib.grid({rows: 4, cols: 4, screen})

  renderLineCharts(grid, screen, 'Total critical alerts', [0,0,1,2], data, 'total_critical_alerts')
  renderLineCharts(grid, screen, 'Total high alerts', [0,2,1,2], data, 'total_high_alerts')
  renderLineCharts(grid, screen, 'Total critical alerts added to main', [1,0,1,2], data, 'total_critical_added')
  renderLineCharts(grid, screen, 'Total high alerts added to main', [1,2,1,2], data, 'total_high_added')
  renderLineCharts(grid, screen, 'Total critical alerts prevented from main', [2,0,1,2], data, 'total_critical_prevented')
  renderLineCharts(grid, screen, 'Total high alerts prevented from main', [2,2,1,2], data, 'total_high_prevented')

  const bar = grid.set(3, 0, 1, 2, contrib.bar,
      { label: 'Top 5 alert types'
      , barWidth: 10
      , barSpacing: 17
      , xOffset: 0
      , maxHeight: 9, barBgColor: 'magenta' })

   screen.append(bar) //must append before setting data

   const top5AlertTypes = Object.values(data)[0].top_five_alert_types
   
   bar.setData(
      { titles: Object.keys(top5AlertTypes)
      , data: Object.values(top5AlertTypes)})

  screen.render()
    
  screen.key(['escape', 'q', 'C-c'], function() {
    return process.exit(0);
  })
}

const renderLineCharts = (grid: any, screen: any, title: string, coords: number[], data: {[key: string]: {[key: string]: number}}, label: string) => {
  const formattedDates = Object.keys(data).map(d => `${new Date(d).getMonth()+1}/${new Date(d).getDate()}`)

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
    x: formattedDates.reverse(),
    y: alertsCounts
  }

  line.setData([lineData])
}