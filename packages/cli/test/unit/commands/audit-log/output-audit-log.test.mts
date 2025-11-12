/**
 * Unit tests for audit log output formatting functions.
 *
 * Tests the data transformation and output formatting for audit logs.
 * These tests use fixture data and snapshot testing for both JSON and markdown output.
 *
 * Test Coverage:
 * - JSON output formatting with complete audit log data
 * - Markdown output with table rendering
 * - Error handling with empty/invalid data (returns empty object or error report)
 * - Audit log metadata (org, type filter, page, perPage, next page)
 * - Event fields (event_id, created_at, type, user_email, ip_address, user_agent)
 * - Pagination information in output
 * - Generated timestamp redaction in snapshots
 *
 * Testing Approach:
 * - Load audit-fixture.json for realistic test data
 * - Use inline snapshots to verify formatting output
 * - Test both successful results and error cases
 * - Verify markdown table structure with proper headers and separators
 * - Test JSON stringification of audit log structures
 *
 * Related Files:
 * - src/commands/audit-log/output-audit-log.mts - Implementation
 * - src/commands/audit-log/audit-fixture.json - Test fixture data
 * - src/commands/audit-log/handle-audit-log.mts - Handler that uses output functions
 */

import { describe, expect, it } from 'vitest'

import FIXTURE from '../../../../src/commands/audit-log/audit-fixture.json' with {
  type: 'json',
}
import {
  outputAsJson,
  outputAsMarkdown,
} from '../../../../src/commands/audit-log/output-audit-log.mts'
import { createSuccessResult } from '../../../helpers/mocks.mts'

import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type AuditLogs = SocketSdkSuccessResult<'getAuditLogEvents'>['data']['results']

describe('output-audit-log', () => {
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
                "user_email": "person@socket.dev"
              },
              {
                "event_id": "122421",
                "created_at": "2025-03-31T15:19:55.299Z",
                "ip_address": "123.123.321.213",
                "type": "createApiToken",
                "user_agent": "",
                "user_email": "person@socket.dev"
              },
              {
                "event_id": "121392",
                "created_at": "2025-03-27T16:24:36.344Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "super ai .com",
                "user_email": "person@socket.dev"
              },
              {
                "event_id": "121391",
                "created_at": "2025-03-27T16:24:33.912Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "",
                "user_email": "person@socket.dev"
              },
              {
                "event_id": "120287",
                "created_at": "2025-03-24T21:52:12.879Z",
                "ip_address": "",
                "type": "updateAlertTriage",
                "user_agent": "",
                "user_email": "person@socket.dev"
              },
              {
                "event_id": "118431",
                "created_at": "2025-03-17T15:57:29.885Z",
                "ip_address": "",
                "type": "updateOrganizationSetting",
                "user_agent": "",
                "user_email": "person@socket.dev"
              },
              {
                "event_id": "116928",
                "created_at": "2025-03-10T22:53:35.734Z",
                "ip_address": "",
                "type": "updateApiTokenScopes",
                "user_agent": "",
                "user_email": "person@socket.dev"
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
      expect(r).toMatchInlineSnapshot(`
        "{}
        "
      `)
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
      expect(r).toMatchInlineSnapshot(`
        "
        # Socket Audit Logs

        These are the Socket.dev audit logs as per requested query.
        - org: noorgslug
        - type filter: (none)
        - page: 1
        - next page: 2
        - per page: 10
        - generated: <redacted>

        | -------- | ------------------------ | ------------------------- | ----------------- | --------------- | ------------- |
        | event_id | created_at               | type                      | user_email        | ip_address      | user_agent    |
        | -------- | ------------------------ | ------------------------- | ----------------- | --------------- | ------------- |
        | 123112   | 2025-04-02T01:47:26.914Z | updateOrganizationSetting | person@socket.dev |                 |               |
        | 122421   | 2025-03-31T15:19:55.299Z | createApiToken            | person@socket.dev | 123.123.321.213 |               |
        | 121392   | 2025-03-27T16:24:36.344Z | updateOrganizationSetting | person@socket.dev |                 | super ai .com |
        | 121391   | 2025-03-27T16:24:33.912Z | updateOrganizationSetting | person@socket.dev |                 |               |
        | 120287   | 2025-03-24T21:52:12.879Z | updateAlertTriage         | person@socket.dev |                 |               |
        | 118431   | 2025-03-17T15:57:29.885Z | updateOrganizationSetting | person@socket.dev |                 |               |
        | 116928   | 2025-03-10T22:53:35.734Z | updateApiTokenScopes      | person@socket.dev |                 |               |
        | -------- | ------------------------ | ------------------------- | ----------------- | --------------- | ------------- |
        "
      `)
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
      expect(r).toMatchInlineSnapshot(
        `"Failed to generate the markdown report"`,
      )
    })
  })
})
