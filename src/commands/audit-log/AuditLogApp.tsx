/** @fileoverview Audit log Ink React component. */

import { Box, Text, useApp, useInput } from 'ink'
import InkTable from 'ink-table'
import React, { useState } from 'react'

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

export function AuditLogApp({
  orgSlug,
  results,
}: AuditLogAppProps): React.ReactElement {
  const { exit } = useApp()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectedEntry = results[selectedIndex]

  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      exit()
    } else if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(results.length - 1, prev + 1))
    } else if (key.return) {
      const selected = results[selectedIndex]
      if (selected) {
        const formatted = formatEntry(selected, true)
        // Write to stdout before exiting.
        process.stdout.write(`Last selection:\n${formatted}\n`)
      }
      exit()
    }
  })

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

      {/* Tips */}
      <Box
        borderStyle="single"
        borderColor="yellow"
        paddingX={1}
        backgroundColor="black"
      >
        <Text color="yellow">↑/↓: Move Enter: Select q/ESC: Quit</Text>
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
