/**
 * @fileoverview iocraft-based analytics renderer.
 *
 * Non-interactive renderer for analytics data using iocraft native bindings.
 * This is a proof-of-concept implementation for the hybrid Ink/iocraft approach.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { Box, Text, print } from '../../utils/terminal/iocraft.mts'

import type { FormattedData } from './output-analytics.mts'

const logger = getDefaultLogger()

/**
 * Render analytics data using iocraft.
 *
 * Non-interactive version - displays data and exits immediately.
 */
export function displayAnalyticsWithIocraft(data: FormattedData): void {
  try {
    // Check if data is empty
    const hasTopAlerts = Object.keys(data.top_five_alert_types).length > 0
    const hasCriticalAlerts = Object.keys(data.total_critical_alerts).length > 0
    const hasHighAlerts = Object.keys(data.total_high_alerts).length > 0

    if (!hasTopAlerts && !hasCriticalAlerts && !hasHighAlerts) {
      const emptyTree = Box({
        children: [
          Text({
            children: 'No analytics data available for this period.',
            color: 'yellow',
          }),
        ],
      })
      print(emptyTree)
      return
    }

    const tree = Box({
    children: [
      Box({
        children: [
          Text({
            bold: true,
            children: 'Socket Analytics',
            color: 'cyan',
          }),
        ],
        marginBottom: 1,
      }),
      Box({
        borderColor: 'cyan',
        borderStyle: 'single',
        children: [
          Box({
            children: [Text({ bold: true, children: 'Top 5 Alert Types:' })],
            marginBottom: 1,
          }),
          ...Object.entries(data.top_five_alert_types).map(({ 0: type, 1: count }) =>
            Box({
              children: [Text({ children: `  ${type}: ${count}` })],
            }),
          ),
        ],
        flexDirection: 'column',
        marginBottom: 1,
        paddingX: 1,
        paddingY: 1,
      }),
      Box({
        borderColor: 'red',
        borderStyle: 'single',
        children: [
          Box({
            children: [
              Text({ bold: true, children: 'Critical Alerts', color: 'red' }),
            ],
            marginBottom: 1,
          }),
          ...Object.entries(data.total_critical_alerts).map(({ 0: date, 1: count }) =>
            Box({
              children: [Text({ children: `  ${date}: ${count}` })],
            }),
          ),
        ],
        flexDirection: 'column',
        marginBottom: 1,
        paddingX: 1,
        paddingY: 1,
      }),
      Box({
        borderColor: 'yellow',
        borderStyle: 'single',
        children: [
          Box({
            children: [
              Text({ bold: true, children: 'High Alerts', color: 'yellow' }),
            ],
            marginBottom: 1,
          }),
          ...Object.entries(data.total_high_alerts).map(({ 0: date, 1: count }) =>
            Box({
              children: [Text({ children: `  ${date}: ${count}` })],
            }),
          ),
        ],
        flexDirection: 'column',
        marginBottom: 1,
        paddingX: 1,
        paddingY: 1,
      }),
    ],
    flexDirection: 'column',
  })

    print(tree)
  } catch (e) {
    process.exitCode = 1
    logger.error('Error rendering analytics:', e instanceof Error ? e.message : String(e))
    logger.warn('Falling back to plain text output')
    logger.log(`Top 5 Alert Types: ${Object.keys(data.top_five_alert_types).length} types`)
    logger.log(`Critical Alerts: ${Object.keys(data.total_critical_alerts).length} dates`)
    logger.log(`High Alerts: ${Object.keys(data.total_high_alerts).length} dates`)
  }
}
