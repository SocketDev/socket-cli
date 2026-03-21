/**
 * @fileoverview Manual test for audit-log iocraft renderer.
 *
 * SETUP: Run once before testing:
 *   node scripts/setup-iocraft-dev.mjs
 *
 * RUN TEST:
 *   node --experimental-strip-types src/commands/audit-log/test-audit-log-renderer.mts
 */

import { displayAuditLogWithIocraft } from './AuditLogRenderer.mts'

// Mock data for testing
const mockResults = [
  {
    event_id: 'evt_abc123def456',
    formatted_created_at: '2026-03-20 10:15:00',
    type: 'scan.created',
    user_email: 'engineer@socket.dev',
    ip_address: '192.168.1.100',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    created_at: '2026-03-20T10:15:00Z',
    payload: {
      scan_id: 'scan_123',
      repository: 'socket-cli',
    },
  },
  {
    event_id: 'evt_789ghi012jkl',
    formatted_created_at: '2026-03-19 14:30:00',
    type: 'user.login',
    user_email: 'admin@socket.dev',
    ip_address: '192.168.1.101',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    created_at: '2026-03-19T14:30:00Z',
    payload: {
      success: true,
    },
  },
  {
    event_id: 'evt_mno345pqr678',
    formatted_created_at: '2026-03-18 09:45:00',
    type: 'package.analyzed',
    user_email: 'bot@socket.dev',
    ip_address: '10.0.0.50',
    user_agent: 'socket-cli/1.0.0',
    created_at: '2026-03-18T09:45:00Z',
    payload: {
      package_name: '@socketsecurity/cli',
      version: '1.0.0',
    },
  },
]

console.log('Testing Audit Log Renderer with iocraft\n')
displayAuditLogWithIocraft({
  orgSlug: 'socket-dev',
  results: mockResults,
})
console.log('\n✅ Audit log renderer test complete')
