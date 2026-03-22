import { describe, expect, it } from 'vitest'

import { renderToString } from '../../../../src/utils/terminal/iocraft.mts'
import { Box, Text } from '../../../../src/utils/terminal/iocraft.mts'

import type { AuditLogEntry } from '../../../../src/commands/audit-log/AuditLogRenderer.mts'

describe('AuditLogRenderer', () => {
  describe('empty data handling', () => {
    it('should render empty state when no audit logs found', () => {
      const tree = Box({
        children: [
          Text({
            children: 'No audit log entries found.',
            color: 'yellow',
          }),
        ],
      })

      const output = renderToString(tree)
      expect(output).toMatchInlineSnapshot(`
        "No audit log entries found.
        "
      `)
    })
  })

  describe('data rendering', () => {
    it('should render audit log table with multiple entries', () => {
      const results: AuditLogEntry[] = [
        {
          created_at: '2024-04-19T10:30:00Z',
          event_id: 'evt_123456789012345678',
          formatted_created_at: 'Apr 19, 2024 10:30 AM',
          ip_address: '192.168.1.1',
          payload: { action: 'created', resource: 'repo' },
          type: 'repository.created',
          user_agent: 'Mozilla/5.0',
          user_email: 'user@example.com',
        },
        {
          created_at: '2024-04-19T11:00:00Z',
          event_id: 'evt_234567890123456789',
          formatted_created_at: 'Apr 19, 2024 11:00 AM',
          ip_address: '192.168.1.2',
          payload: { action: 'updated', resource: 'settings' },
          type: 'settings.updated',
          user_agent: 'Chrome/120.0',
          user_email: 'admin@example.com',
        },
      ]

      const orgSlug = 'test-org'

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
        ],
        flexDirection: 'column',
      })

      const output = renderToString(tree)
      expect(output).toMatchSnapshot()
    })
  })
})
