import { describe, expect, it } from 'vitest'

import FIXTURE from './audit-fixture.json' with { type: 'json' }
import { outputAsJson, outputAsMarkdown } from './output-audit-log.mts'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type AuditLogs = SocketSdkReturnType<'getAuditLogEvents'>['data']['results']

describe('output-audit-log', () => {
  describe('json', () => {
    it('should return formatted json string', async () => {
      const r = await outputAsJson(
        { ok: true, data: JSON.parse(JSON.stringify(FIXTURE)) },
        {
          logType: '',
          orgSlug: 'noorgslug',
          page: 1,
          perPage: 10,
        },
      )
      expect(r).toMatchInlineSnapshot(`
        "{
          "ok": true,
          "data": {
            "desc": "Audit logs for given query",
            "generated": "<redacted>",
            "org": "noorgslug",
            "logType": "",
            "page": 1,
            "nextPage": "2",
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
      `)
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
