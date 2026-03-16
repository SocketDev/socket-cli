/**
 * @fileoverview iocraft-based analytics renderer.
 *
 * Non-interactive renderer for analytics data using iocraft native bindings.
 * This is a proof-of-concept implementation for the hybrid Ink/iocraft approach.
 */

import { Box, Text, print } from '../../utils/terminal/iocraft.mts'

import type { FormattedData } from './output-analytics.mts'

/**
 * Render analytics data using iocraft.
 *
 * Non-interactive version - displays data and exits immediately.
 * Press 'q' to quit will be added when InteractiveRenderer is implemented.
 */
export async function displayAnalyticsWithIocraft(
  data: FormattedData,
): Promise<void> {
  const tree = Box({
    children: [
      Box({
        children: [
          Text({
            bold: true,
            children: '📊 Socket Analytics (iocraft)',
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
          ...Object.entries(data.top_five_alert_types).map(([type, count]) =>
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
          ...Object.entries(data.total_critical_alerts).map(([date, count]) =>
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
          ...Object.entries(data.total_high_alerts).map(([date, count]) =>
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
        backgroundColor: 'black',
        borderColor: 'gray',
        borderStyle: 'single',
        children: [
          Text({
            children:
              '💡 TIP: This is rendered with iocraft (SOCKET_CLI_USE_IOCRAFT=1)',
            color: 'gray',
          }),
        ],
        marginTop: 1,
        paddingX: 1,
      }),
    ],
    flexDirection: 'column',
  })

  print(tree)
}
