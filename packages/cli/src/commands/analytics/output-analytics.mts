import fs from 'node:fs/promises'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { debugFileOp } from '../../utils/debug.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdTableStringNumber } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { fileLink } from '../../utils/terminal/link.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
const logger = getDefaultLogger()


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
  'total_low_prevented',
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
  'Dec',
] as const

export type OutputAnalyticsConfig = {
  filepath: string
  outputKind: OutputKind
  repo: string
  scope: string
  time: number
}

export async function outputAnalytics(
  result: CResult<
    | SocketSdkSuccessResult<'getOrgAnalytics'>['data']
    | SocketSdkSuccessResult<'getRepoAnalytics'>['data']
  >,
  { filepath, outputKind, repo, scope, time }: OutputAnalyticsConfig,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      logger.log(serializeResultJson(result))
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === 'json') {
    const serialized = serializeResultJson(result)

    if (filepath) {
      try {
        await fs.writeFile(filepath, serialized, 'utf8')
        debugFileOp('write', filepath)
        logger.success(
          `Data successfully written to ${fileLink(filepath)}`,
        )
      } catch (e) {
        debugFileOp('write', filepath, e)
        process.exitCode = 1
        logger.log(
          serializeResultJson({
            ok: false,
            message: 'File Write Failure',
            cause: 'There was an error trying to write the json to disk',
          }),
        )
      }
    } else {
      logger.log(serialized)
    }

    return
  }

  const fdata =
    scope === 'org' ? formatDataOrg(result.data) : formatDataRepo(result.data)

  if (outputKind === 'markdown') {
    const serialized = renderMarkdown(fdata, time, repo)

    // Write markdown output to file if filepath is specified.
    if (filepath) {
      try {
        await fs.writeFile(filepath, serialized, 'utf8')
        debugFileOp('write', filepath)
        logger.success(
          `Data successfully written to ${fileLink(filepath)}`,
        )
      } catch (e) {
        debugFileOp('write', filepath, e)
        logger.error(e)
      }
    } else {
      logger.log(serialized)
    }
  } else {
    await displayAnalyticsWithInk(fdata)
  }
}

export interface FormattedData {
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

export function renderMarkdown(
  data: FormattedData,
  days: number,
  repoSlug: string,
): string {
  return `${`
# Socket Alert Analytics

These are the Socket.dev analytics for the ${repoSlug ? `${repoSlug} repo` : 'org'} of the past ${days} days

${[
  [
    'Total critical alerts',
    mdTableStringNumber('Date', 'Counts', data.total_critical_alerts),
  ],
  [
    'Total high alerts',
    mdTableStringNumber('Date', 'Counts', data.total_high_alerts),
  ],
  [
    'Total critical alerts added to the main branch',
    mdTableStringNumber('Date', 'Counts', data.total_critical_added),
  ],
  [
    'Total high alerts added to the main branch',
    mdTableStringNumber('Date', 'Counts', data.total_high_added),
  ],
  [
    'Total critical alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data.total_critical_prevented),
  ],
  [
    'Total high alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data.total_high_prevented),
  ],
  [
    'Total medium alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data.total_medium_prevented),
  ],
  [
    'Total low alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data.total_low_prevented),
  ],
]
  .map(([title, table]) =>
    `
## ${title}

${table}
`.trim(),
  )
  .join('\n\n')}

## Top 5 alert types

${mdTableStringNumber('Name', 'Counts', data.top_five_alert_types)}
`.trim()}\n`
}

/**
 * Display analytics using Ink React components.
 */
async function displayAnalyticsWithInk(data: FormattedData): Promise<void> {
  const React = await import('react')
  const { render } = await import('ink')
  const { AnalyticsApp } = await import('./AnalyticsApp.js')

  render(React.createElement(AnalyticsApp, { data }))
}

export function formatDataRepo(
  data: SocketSdkSuccessResult<'getRepoAnalytics'>['data'],
): FormattedData {
  const sortedTopFiveAlerts: Record<string, number> = {}
  const totalTopAlerts: Record<string, number> = {}

  const formattedData = {} as Omit<FormattedData, 'top_five_alert_types'>
  for (const metric of METRICS) {
    formattedData[metric] = {}
  }

  for (const entry of data) {
    const topFiveAlertTypes = entry.top_five_alert_types
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
      formattedData[metric]![formatDate(entry.created_at)] = entry[metric]
    }
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .sort(([_keya, a], [_keyb, b]) => b - a)
    .slice(0, 5)
  for (const { 0: key, 1: value } of topFiveAlertEntries) {
    sortedTopFiveAlerts[key] = value
  }

  return {
    ...formattedData,
    top_five_alert_types: sortedTopFiveAlerts,
  }
}

export function formatDataOrg(
  data: SocketSdkSuccessResult<'getOrgAnalytics'>['data'],
): FormattedData {
  const sortedTopFiveAlerts: Record<string, number> = {}
  const totalTopAlerts: Record<string, number> = {}

  const formattedData = {} as Omit<FormattedData, 'top_five_alert_types'>
  for (const metric of METRICS) {
    formattedData[metric] = {}
  }

  for (const entry of data) {
    const topFiveAlertTypes = entry.top_five_alert_types
    for (const type of Object.keys(topFiveAlertTypes)) {
      const count = topFiveAlertTypes[type] ?? 0
      if (totalTopAlerts[type]) {
        totalTopAlerts[type] += count
      } else {
        totalTopAlerts[type] = count
      }
    }
  }

  for (const metric of METRICS) {
    const formatted = formattedData[metric]
    for (const entry of data) {
      const date = formatDate(entry.created_at)
      if (formatted[date]) {
        formatted[date] += entry[metric]!
      } else {
        formatted[date] = entry[metric]!
      }
    }
  }

  const topFiveAlertEntries = Object.entries(totalTopAlerts)
    .sort(([_keya, a], [_keyb, b]) => b - a)
    .slice(0, 5)
  for (const { 0: key, 1: value } of topFiveAlertEntries) {
    sortedTopFiveAlerts[key] = value
  }

  return {
    ...formattedData,
    top_five_alert_types: sortedTopFiveAlerts,
  }
}

function formatDate(date: string): string {
  return `${Months[new Date(date).getMonth()]} ${new Date(date).getDate()}`
}
