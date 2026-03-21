/**
 * @fileoverview iocraft-based audit log renderer.
 *
 * Non-interactive renderer for audit log data using iocraft native bindings.
 */

import { Box, Text, print } from '../../utils/terminal/iocraft.mts'

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
                    entry.event_id.slice(0, 18).padEnd(20),
                    entry.formatted_created_at.padEnd(25),
                    entry.type.padEnd(30),
                    entry.user_email.padEnd(30),
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
                children: formatEntry(results[0]!),
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
}
