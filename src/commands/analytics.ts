// @ts-nocheck
// @ts-ignore
import blessed from 'blessed'
import contrib from 'blessed-contrib'
import chalk from 'chalk'
// @ts-ignore
import chalkTable from 'chalk-table'
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
        await fetchOrgAnalyticsData(input.time, spinner, apiKey)
      } else {
        if (input.repo) {
          await fetchRepoAnalyticsData(input.repo, input.time, spinner, apiKey)
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

  return {
      scope, time, repo
  }
}

async function fetchOrgAnalyticsData (time: string, spinner: Ora, apiKey: string): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(socketSdk.getOrgAnalytics(time), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getOrgAnalytics', result, spinner)
  }

  spinner.stop()

  // const data = result.data.reduce((acc: { [key: string]: any }, current) => {
  //   const formattedDate = new Date(current.created_at).toLocaleDateString()

  //   if (acc[formattedDate]) {
  //     acc[formattedDate].total_critical_alerts += current.total_critical_alerts
  //     acc[formattedDate].total_high_alerts += current.total_high_alerts
  //     acc[formattedDate].total_critical_added += current.total_critical_added
  //     acc[formattedDate].total_high_added += current.total_high_added
  //     acc[formattedDate].total_critical_prevented += current.total_critical_prevented
  //     acc[formattedDate].total_high_prevented += current.total_high_prevented
  //     acc[formattedDate].total_medium_prevented += current.total_medium_prevented
  //     acc[formattedDate].total_low_prevented += current.total_low_prevented
  //     // acc[formattedDate].top_five_alert_types += current.top_five_alert_types
  //   } else {
  //     acc[formattedDate] = current
  //     acc[formattedDate].created_at = formattedDate
  //   }

  //   return acc
  // }, {})

  // console.log(data)

  // const options = {
  //   columns: [
  //     { field: 'created_at', name: chalk.cyan('Date') },
  //     { field: 'total_critical_alerts', name: chalk.cyan('Critical alerts') },
  //     { field: 'total_high_alerts', name: chalk.cyan('High alerts') },
  //     { field: 'total_critical_added', name: chalk.cyan('Critical alerts added') },
  //     { field: 'total_high_added', name: chalk.cyan('High alerts added') },
  //     { field: 'total_critical_prevented', name: chalk.cyan('Critical alerts prevented') },
  //     { field: 'total_medium_prevented', name: chalk.cyan('Medium alerts prevented') },
  //     { field: 'total_low_prevented', name: chalk.cyan('Low alerts prevented') },
  //   ]
  // }

  // console.log(chalk.bgMagenta.white.bold(`\n Analytics data at the organization level over the last ${time} days (indicated in total amount): \n`))
  // console.log(`${chalkTable(options, Object.values(data))}\n`)

  const screen = blessed.screen()
  // eslint-disable-next-line
  const grid = new contrib.grid({rows: 4, cols: 4, screen})

  renderLineCharts(grid, screen, 'Critical alerts', [0,0,1,1.5])
  renderLineCharts(grid, screen, 'High alerts', [0,1.5,1,1.5])
  renderLineCharts(grid, screen, 'Critical alerts added to main', [1,0,1,2])
  renderLineCharts(grid, screen, 'High alerts added to main', [1,2,1,2])
  renderLineCharts(grid, screen, 'Critical alerts prevented from main', [2,0,1,2])
  renderLineCharts(grid, screen, 'High alerts prevented to main', [2,2,1,2])

  const bar = grid.set(3, 0, 1, 1, contrib.bar,
      { label: 'Top 5 alert types'
      , barWidth: 4
      , barSpacing: 6
      , xOffset: 0
      , maxHeight: 9})

   screen.append(bar) //must append before setting data

   bar.setData(
      { titles: ['Env vars', 'stuff']
      , data: [5, 10]})

  screen.render()
    
  screen.key(['escape', 'q', 'C-c'], function(ch, key) {
    return process.exit(0);
  })
}

async function fetchRepoAnalyticsData (repo: string, time: string, spinner: Ora, apiKey: string): Promise<void> {
  const socketSdk = await setupSdk(apiKey)
  const result = await handleApiCall(socketSdk.getRepoAnalytics(repo, time), 'fetching analytics data')

  if (result.success === false) {
    return handleUnsuccessfulApiResponse('getRepoAnalytics', result, spinner)
  }
  spinner.stop()

  const formattedData = result.data.map(d => {
    const formattedDate = new Date(d.created_at).toLocaleDateString()
    return {
      ...d,
      created_at: formattedDate,
    }
  })
  const data = { ...formattedData.flat(1) }

  const options = {
    columns: [
      { field: 'created_at', name: chalk.cyan('Date') },
      { field: 'total_critical_alerts', name: chalk.cyan('Critical alerts') },
      { field: 'total_high_alerts', name: chalk.cyan('High alerts') },
      { field: 'total_critical_added', name: chalk.cyan('Critical alerts added') },
      { field: 'total_high_added', name: chalk.cyan('High alerts added') },
      { field: 'total_critical_prevented', name: chalk.cyan('Critical alerts prevented') },
      { field: 'total_medium_prevented', name: chalk.cyan('Medium alerts prevented') },
      { field: 'total_low_prevented', name: chalk.cyan('Low alerts prevented') },
    ]
  }

  console.log(chalk.bgMagenta.white.bold(`\n Analytics data for ${repo} over the last ${time} days: \n`))
  console.log(`${chalkTable(options, Object.values(data))}\n`)
}


const renderLineCharts = (grid, screen, title, coords) => {
  const line = grid.set(...coords, contrib.line,
    { style:
      { line: "cyan"
      , text: "cyan"
      , baseline: "black"}
    , xLabelPadding: 0
    , xPadding: 0,
    xOffset: 0,
    legend: {width: 1}
    , label: title})

  screen.append(line)

  const lineData = {
    // x: Object.keys(data),
    x: ['8/22', '8/21', '8/20', '8/19', '8/18', '8/17', '8/16'].reverse(),
    y: [0, 0, 0, 0, 0, 12, 50]
  }

  line.setData([lineData])
}