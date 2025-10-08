/** @fileoverview Analytics output formatting for Socket CLI. Formats organization and repository analytics in JSON, markdown, or text format with metrics tables and file export support. */

import fs from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'

import { debugFileOp } from '../../utils/debug.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTableStringNumber } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'
import { fileLink } from '../../utils/terminal-link.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

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
        logger.success(`Data successfully written to ${fileLink(filepath)}`)
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

    // TODO: Do we want to write to file even if there was an error...?
    if (filepath) {
      try {
        await fs.writeFile(filepath, serialized, 'utf8')
        debugFileOp('write', filepath)
        logger.success(`Data successfully written to ${fileLink(filepath)}`)
      } catch (e) {
        debugFileOp('write', filepath, e)
        logger.error(e)
      }
    } else {
      logger.log(serialized)
    }
  } else {
    displayAnalyticsScreen(fdata)
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
  return (
    `
# Socket Alert Analytics

These are the Socket.dev analytics for the ${repoSlug ? `${repoSlug} repo` : 'org'} of the past ${days} days

${[
  [
    'Total critical alerts',
    mdTableStringNumber('Date', 'Counts', data['total_critical_alerts']),
  ],
  [
    'Total high alerts',
    mdTableStringNumber('Date', 'Counts', data['total_high_alerts']),
  ],
  [
    'Total critical alerts added to the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_critical_added']),
  ],
  [
    'Total high alerts added to the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_high_added']),
  ],
  [
    'Total critical alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_critical_prevented']),
  ],
  [
    'Total high alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_high_prevented']),
  ],
  [
    'Total medium alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_medium_prevented']),
  ],
  [
    'Total low alerts prevented from the main branch',
    mdTableStringNumber('Date', 'Counts', data['total_low_prevented']),
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

${mdTableStringNumber('Name', 'Counts', data['top_five_alert_types'])}
`.trim() + '\n'
  )
}

async function displayAnalyticsScreen(data: FormattedData): Promise<void> {
  try {
    // Dynamically import React and Ink only when needed
    const [{ render }, React, { AnalyticsApp }] = await Promise.all([
      import('ink'),
      import('react'),
      import('./AnalyticsApp.js'),
    ])

    // Render the Ink app directly in the current process.
    const { waitUntilExit } = render(React.createElement(AnalyticsApp, { data }))

    await waitUntilExit()
  } catch (error) {
    // Fallback to simple text output if React/Ink fails to load
    logger.error('Failed to load interactive display. Falling back to text output.')
    displayAnalyticsTextFallback(data)
  }
}

// Fallback text display when React/Ink is not available
function displayAnalyticsTextFallback(data: FormattedData): void {
  logger.log('\n📊 Analytics Report\n')

  // Display top 5 alert types
  if (Object.keys(data.top_five_alert_types).length > 0) {
    logger.log('Top 5 Alert Types:')
    for (const [type, count] of Object.entries(data.top_five_alert_types)) {
      logger.log(`  ${type}: ${count}`)
    }
    logger.log('')
  }

  // Display key metrics
  const metrics = [
    ['Critical Alerts', data.total_critical_alerts],
    ['High Alerts', data.total_high_alerts],
    ['Medium Alerts', data.total_medium_alerts],
    ['Low Alerts', data.total_low_alerts],
  ] as const

  for (const [label, values] of metrics) {
    if (Object.keys(values).length > 0) {
      logger.log(`${label}:`)
      for (const [date, count] of Object.entries(values)) {
        logger.log(`  ${date}: ${count}`)
      }
      logger.log('')
    }
  }
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
    const topFiveAlertTypes = entry['top_five_alert_types']
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
      const date = formatDate(entry['created_at'])
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
