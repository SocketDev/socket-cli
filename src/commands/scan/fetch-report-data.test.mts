process.env['SOCKET_CLI_API_TOKEN'] = 'test-token'
process.env['SOCKET_CLI_API_BASE_URL'] = 'https://api.socket.dev/v0/'

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fetchScanData } from './fetch-report-data.mts'

const BASE_HOST = 'https://api.socket.dev'

describe('fetchScanData', () => {
  beforeEach(() => {
    nock.cleanAll()
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  it('fetches scan alerts with resolved actions without requesting policy', async () => {
    nock(BASE_HOST)
      .get('/v0/orgs/test-org/full-scans/scan-1')
      .reply(
        200,
        `${JSON.stringify({
          type: 'npm',
          name: 'lodash',
          version: '4.17.21',
          alerts: [{ type: 'envVars', action: 'error' }],
        })}\n`,
      )

    const result = await fetchScanData('test-org', 'scan-1')

    expect(result).toEqual({
      ok: true,
      data: {
        scan: [
          {
            type: 'npm',
            name: 'lodash',
            version: '4.17.21',
            alerts: [{ type: 'envVars', action: 'error' }],
          },
        ],
      },
    })
    expect(nock.isDone()).toBe(true)
  })

  it('requests license details when the license option is enabled', async () => {
    nock(BASE_HOST)
      .get('/v0/orgs/test-org/full-scans/scan-2')
      .query({ include_license_details: 'true' })
      .reply(200, '')

    const result = await fetchScanData('test-org', 'scan-2', {
      includeLicensePolicy: true,
    })

    expect(result).toEqual({ ok: true, data: { scan: [] } })
    expect(nock.isDone()).toBe(true)
  })
})
