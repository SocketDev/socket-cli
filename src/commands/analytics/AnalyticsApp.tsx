// @ts-nocheck
/** @fileoverview Analytics Ink React component. */

import { Box, Text, useApp, useInput } from 'ink'
import type React from 'react'

export type FormattedData = {
  top_five_alert_types: Record<string, number>
  total_critical_alerts: Record<string, number>
  total_critical_added: Record<string, number>
  total_critical_prevented: Record<string, number>
  total_high_alerts: Record<string, number>
  total_high_added: Record<string, number>
  total_high_prevented: Record<string, number>
  total_low_added: Record<string, number>
  total_low_prevented: Record<string, number>
  total_medium_added: Record<string, number>
  total_medium_prevented: Record<string, number>
}

export type AnalyticsAppProps = {
  data: FormattedData
}

/**
 * Render a simple bar chart using text characters.
 */
function renderBarChart(data: Record<string, number>): string {
  const entries = Object.entries(data)
  if (!entries.length) {
    return '(no data)'
  }

  const maxValue = Math.max(...entries.map(({ 1: v }) => v))
  const maxBarLength = 40

  return entries
    .map(({ 0: label, 1: value }) => {
      const barLength = Math.round((value / maxValue) * maxBarLength)
      const bar = '█'.repeat(barLength)
      return `${label.padEnd(30)} ${bar} ${value}`
    })
    .join('\n')
}

/**
 * Render a simple line chart summary.
 */
function renderLineChartSummary(
  title: string,
  data: Record<string, number>,
): string {
  const entries = Object.entries(data)
  if (!entries.length) {
    return `${title}: (no data)`
  }

  const total = entries.reduce((sum, { 1: v }) => sum + v, 0)
  const avg = Math.round(total / entries.length)
  const max = Math.max(...entries.map(({ 1: v }) => v))
  const min = Math.min(...entries.map(({ 1: v }) => v))

  return `${title}:\n  Total: ${total} | Avg: ${avg} | Max: ${max} | Min: ${min}`
}

export function AnalyticsApp({ data }: AnalyticsAppProps): React.ReactElement {
  const { exit } = useApp()

  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      exit()
    }
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Socket Alert Analytics
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>
          Alert Summaries:
        </Text>
        <Text>
          {renderLineChartSummary(
            'Total critical alerts',
            data.total_critical_alerts,
          )}
        </Text>
        <Text>
          {renderLineChartSummary('Total high alerts', data.total_high_alerts)}
        </Text>
        <Text>
          {renderLineChartSummary(
            'Critical alerts added to main',
            data.total_critical_added,
          )}
        </Text>
        <Text>
          {renderLineChartSummary(
            'High alerts added to main',
            data.total_high_added,
          )}
        </Text>
        <Text>
          {renderLineChartSummary(
            'Critical alerts prevented',
            data.total_critical_prevented,
          )}
        </Text>
        <Text>
          {renderLineChartSummary(
            'High alerts prevented',
            data.total_high_prevented,
          )}
        </Text>
        <Text>
          {renderLineChartSummary(
            'Medium alerts prevented',
            data.total_medium_prevented,
          )}
        </Text>
        <Text>
          {renderLineChartSummary(
            'Low alerts prevented',
            data.total_low_prevented,
          )}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold underline>
          Top 5 Alert Types:
        </Text>
        <Text>{renderBarChart(data.top_five_alert_types)}</Text>
      </Box>

      <Box
        borderStyle="single"
        borderColor="yellow"
        paddingX={1}
        backgroundColor="black"
      >
        <Text color="yellow">q/ESC: Quit</Text>
      </Box>
    </Box>
  )
}
