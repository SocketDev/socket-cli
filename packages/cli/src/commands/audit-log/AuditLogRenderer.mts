/**
 * @fileoverview iocraft-based audit log renderer.
 *
 * Non-interactive renderer for audit log data using iocraft native bindings.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { Box, Text, print } from '../../utils/terminal/iocraft.mts'

const logger = getDefaultLogger()

export interface AuditLogEntry {
  created_at: string
  event_id: string
  formatted_created_at: string
  ip_address: string
  payload?: Record<string, any>
  type: string
  user_agent: string
  user_email: string
}

export interface AuditLogRendererProps {
  orgSlug: string
  results: AuditLogEntry[]
}

/**
 * Format audit log entry as JSON with compact payload.
 */
function formatEntry(entry: AuditLogEntry): string {
  const obj = { ...entry, payload: 'REPLACEME' }
  const json = JSON.stringify(obj, null, 2).replace(
    /"payload": "REPLACEME"/,
    `"payload": ${JSON.stringify(entry.payload ?? {})}`,
  )
  return json.replace(/^\s*"([^"]+)?"/gm, '  $1')
}

/**
 * Render audit log data using iocraft.
 *
 * Non-interactive version - displays data as a table.
 */
export function displayAuditLogWithIocraft({
  orgSlug,
  results,
}: AuditLogRendererProps): void {
  try {
    if (!results.length) {
      const tree = Box({
        children: [
          Text({
            children: 'No audit log entries found.',
            color: 'yellow',
          }),
        ],
      })
      print(tree)
      return
    }

    const firstEntry = results[0]!

    const tree = Box({
    children: [
      Box({
        children: [
          Text({
            bold: true,
            children: `Socket Audit Logs for ${orgSlug}`,
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
            children: [
              Text({
                bold: true,
                children: [
                  'Event ID'.padEnd(20),
                  'Created At'.padEnd(25),
                  'Event Type'.padEnd(30),
                  'User Email'.padEnd(30),
                ].join(' '),
              }),
            ],
            marginBottom: 1,
          }),
          ...results.map(entry =>
            Box({
              children: [
                Text({
                  children: [
                    (entry.event_id || '').slice(0, 18).padEnd(20),
                    (entry.formatted_created_at || '').padEnd(25),
                    (entry.type || '').padEnd(30),
                    (entry.user_email || '').padEnd(30),
                  ].join(' '),
                }),
              ],
            }),
          ),
        ],
        flexDirection: 'column',
        marginBottom: 1,
        paddingX: 1,
        paddingY: 1,
      }),
      Box({
        borderColor: 'cyan',
        borderStyle: 'single',
        children: [
          Box({
            children: [
              Text({
                bold: true,
                children: 'First Entry Details:',
                color: 'cyan',
              }),
            ],
            marginBottom: 1,
          }),
          Box({
            children: [
              Text({
                children: formatEntry(firstEntry),
              }),
            ],
          }),
        ],
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 1,
      }),
    ],
    flexDirection: 'column',
  })

    print(tree)
  } catch (e) {
    process.exitCode = 1
    logger.error('Error rendering audit log:', e instanceof Error ? e.message : String(e))
    logger.warn('Falling back to plain text output')
    logger.log(`Organization: ${orgSlug}`)
    logger.log(`Entries: ${results.length}`)
    results.slice(0, 10).forEach((entry, i) => {
      logger.log(`[${i + 1}] ${entry.event_id || 'N/A'} - ${entry.type || 'N/A'} - ${entry.formatted_created_at || 'N/A'}`)
    })
    if (results.length > 10) {
      logger.log(`... and ${results.length - 10} more entries`)
    }
  }
}
