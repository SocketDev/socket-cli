/** @fileoverview Audit log Ink React component. */

import type { Element } from '../../utils/ink.mts'
// @ts-ignore - tsx files treated as CJS by tsgo
import { Box, InkTable, Text } from '../../utils/ink.mts'

export type AuditLogEntry = {
  created_at: string
  event_id: string
  formatted_created_at: string
  ip_address: string
  payload?: Record<string, unknown>
  type: string
  user_agent: string
  user_email: string
}

export type AuditLogAppProps = {
  orgSlug: string
  results: AuditLogEntry[]
}

/**
 * Format audit log entry as JSON with compact payload.
 */
function formatEntry(entry: AuditLogEntry, keepQuotes = false): string {
  const obj = { ...entry, payload: 'REPLACEME' }
  const json = JSON.stringify(obj, null, 2).replace(
    /"payload": "REPLACEME"/,
    `"payload": ${JSON.stringify(entry.payload ?? {})}`,
  )
  if (keepQuotes) {
    return json
  }
  return json.replace(/^\s*"([^"]+)?"/gm, '  $1')
}

// @ts-ignore - tsx files treated as CJS by tsgo
export function AuditLogApp({ orgSlug, results }: AuditLogAppProps): Element {
  // Note: Interactive features removed because stdin is piped for data transfer
  const selectedIndex = 0

  const selectedEntry = results[selectedIndex]

  const tableData = results.map((entry, index) => ({
    ' ': index === selectedIndex ? '▶' : ' ',
    'Event id': entry.event_id,
    'Created at': entry.formatted_created_at,
    'Event type': entry.type,
    'User email': entry.user_email,
    'IP address': entry.ip_address,
    'User agent': entry.user_agent,
  }))

  return (
    <Box flexDirection="column" height="100%">
      {/* Table */}
      <Box flexGrow={1} flexShrink={1} overflowY="hidden">
        <InkTable data={tableData} />
      </Box>

      {/* Details */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        height={20}
        paddingX={1}
      >
        <Text bold color="cyan">
          Audit Logs for {orgSlug}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>{selectedEntry ? formatEntry(selectedEntry) : '(none)'}</Text>
        </Box>
      </Box>
    </Box>
  )
}
