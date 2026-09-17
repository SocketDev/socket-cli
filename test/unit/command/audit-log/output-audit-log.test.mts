import { parseMarkdownTableRows } from '../../../helpers/markdown-table.mts'
/**
 * Unit tests for audit log output formatting functions.
 *
 * Tests the data transformation and output formatting for audit logs. These
 * tests use fixture data and snapshot testing for both JSON and markdown
 * output.
 *
 * Test Coverage:
 *
 * - JSON output formatting with complete audit log data
 * - Markdown output with table rendering
 * - Error handling with empty/invalid data, returns empty object or error report
 * - Audit log metadata (org, type filter, page, perPage, next page)
 * - Event fields (event_id, created_at, type, user_email, ip_address, user_agent)
 * - Pagination information in output
 * - Generated timestamp redaction in snapshots
 *
 * Testing Approach:
 *
 * - Load audit-fixture.json for realistic test data
 * - Use inline snapshots to verify formatting output
 * - Test both successful results and error cases
 * - Verify markdown table structure with proper headers and separators
 * - Test JSON stringification of audit log structures
 *
 * Related Files:
 *
 * - Src/commands/audit-log/output-audit-log.mts - Implementation
 * - Src/commands/audit-log/audit-fixture.json - Test fixture data
 * - Src/commands/audit-log/handle-audit-log.mts - Handler that uses output
 *   functions
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

import FIXTURE from '../../../../src/command/audit-log/audit-fixture.json' with { type: 'json' }
import {
  outputAsJson,
  outputAsMarkdown,
  outputAuditLog,
} from '../../../../src/command/audit-log/output-audit-log.mts'
import {
  createErrorResult,
  createSuccessResult,
} from '../../../helpers/mocks.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'

type AuditLogs = SocketSdkSuccessResult<'getAuditLogEvents'>['data']['results']

describe('output-audit-log', () => {
  afterEach(() => {
    mockLogger.fail.mockReset()
    mockLogger.log.mockReset()
    process.exitCode = undefined
  })

  describe('output selection', () => {
    const options = {
      logType: '',
      orgSlug: 'example-org',
      outputKind: 'json',
      page: 1,
      perPage: 10,
    } as const

    it('emits only one JSON document for a successful result', async () => {
      await outputAuditLog(
        createSuccessResult(JSON.parse(JSON.stringify(FIXTURE))),
        options,
      )

      expect(mockLogger.log).toHaveBeenCalledTimes(1)
      expect(() => JSON.parse(mockLogger.log.mock.calls[0]![0])).not.toThrow()
      expect(mockLogger.fail).not.toHaveBeenCalled()
    })

    it('emits only one JSON document for a failed result', async () => {
      await outputAuditLog(createErrorResult('API error'), options)

      expect(mockLogger.log).toHaveBeenCalledTimes(1)
      expect(() => JSON.parse(mockLogger.log.mock.calls[0]![0])).not.toThrow()
      expect(mockLogger.fail).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    })
  })

  describe('json', () => {
    it('should return formatted json string', async () => {
      const r = await outputAsJson(
        createSuccessResult(JSON.parse(JSON.stringify(FIXTURE))),
        {
          logType: '',
          orgSlug: 'noorgslug',
          page: 1,
          perPage: 10,
        },
      )
      expect(r).toMatchInlineSnapshot(
        `
        "{
          "ok": true,
          "data": {
            "desc": "Audit logs for given query",
            "generated": "<redacted>",
            "logType": "",
            "nextPage": "2",
            "org": "noorgslug",
            "page": 1,
            "perPage": 10,
            "logs": [
              {
                "event_id": "123112",
                "created_at": "2025-04-02T01:47:26.914Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "",
                "user_email": "person@example.com"
              },
              {
                "event_id": "122421",
                "created_at": "2025-03-31T15:19:55.299Z",
                "ip_address": "123.123.321.213",
                "type": "createApiToken",
                "user_agent": "",
                "user_email": "person@example.com"
              },
              {
                "event_id": "121392",
                "created_at": "2025-03-27T16:24:36.344Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "super ai .com",
                "user_email": "person@example.com"
              },
              {
                "event_id": "121391",
                "created_at": "2025-03-27T16:24:33.912Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "",
                "user_email": "person@example.com"
              },
              {
                "event_id": "120287",
                "created_at": "2025-03-24T21:52:12.879Z",
                "ip_address": "",
                "type": "updateAlertTriage",
                "user_agent": "",
                "user_email": "person@example.com"
              },
              {
                "event_id": "118431",
                "created_at": "2025-03-17T15:57:29.885Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "",
                "user_email": "person@example.com"
              },
              {
                "event_id": "116928",
                "created_at": "2025-03-10T22:53:35.734Z",
                "ip_address": "",
                "type": "updateApiTokenScopes",
                "user_agent": "",
                "user_email": "person@example.com"
              }
            ]
          }
        }
        "
      `,
      )
    })

    it('should return empty object string on error', async () => {
      const r = await outputAsJson({} as AuditLogs, {
        logType: '',
        orgSlug: 'noorgslug',
        page: 1,
        perPage: 10,
      })
      expect(parseMarkdownTableRows(r)).toEqual([])
    })
  })

  describe('markdown', () => {
    it('should return markdown report', async () => {
      const r = await outputAsMarkdown(JSON.parse(JSON.stringify(FIXTURE)), {
        logType: '',
        orgSlug: 'noorgslug',
        page: 1,
        perPage: 10,
      })
      expect(parseMarkdownTableRows(r)).toEqual([
        [
          'event_id',
          'created_at',
          'type',
          'user_email',
          'ip_address',
          'user_agent',
        ],
        [
          '123112',
          '2025-04-02T01:47:26.914Z',
          'updateOrganizationSetting',
          'person@example.com',
          '',
          '',
        ],
        [
          '122421',
          '2025-03-31T15:19:55.299Z',
          'createApiToken',
          'person@example.com',
          '123.123.321.213',
          '',
        ],
        [
          '121392',
          '2025-03-27T16:24:36.344Z',
          'updateOrganizationSetting',
          'person@example.com',
          '',
          'super ai .com',
        ],
        [
          '121391',
          '2025-03-27T16:24:33.912Z',
          'updateOrganizationSetting',
          'person@example.com',
          '',
          '',
        ],
        [
          '120287',
          '2025-03-24T21:52:12.879Z',
          'updateAlertTriage',
          'person@example.com',
          '',
          '',
        ],
        [
          '118431',
          '2025-03-17T15:57:29.885Z',
          'updateOrganizationSetting',
          'person@example.com',
          '',
          '',
        ],
        [
          '116928',
          '2025-03-10T22:53:35.734Z',
          'updateApiTokenScopes',
          'person@example.com',
          '',
          '',
        ],
      ])
    })

    it('should return error report on error', async () => {
      const r = await outputAsMarkdown(
        {}, // this will fail
        {
          logType: '',
          orgSlug: 'noorgslug',
          page: 1,
          perPage: 10,
        },
      )
      expect(process.exitCode).toBe(1)
      expect(parseMarkdownTableRows(r)).toEqual([])
      expect(r).toBeTypeOf('string')
      expect(r.length).toBeGreaterThan(0)
      expect(r.split(/\r?\n/)).toHaveLength(1)
    })
  })
})
