process.env['SOCKET_CLI_API_TOKEN'] = 'test-token'
process.env['SOCKET_CLI_API_BASE_URL'] = 'https://api.socket.dev/v0/'

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fetchScan, parseArtifactsNdjson } from './fetch-scan.mts'

// Drives the real direct-API path through nock (an external HTTP double) rather
// than stubbing owned modules. Cached scan reads hit ?cached=true and poll on
// 202 until a 200 arrives.
const BASE_HOST = 'https://api.socket.dev'

const NDJSON =
  '{"type":"npm","name":"lodash","version":"4.17.21"}\n' +
  '{"type":"npm","name":"react","version":"18.2.0"}\n'

describe('fetchScan', () => {
  beforeEach(() => {
    nock.cleanAll()
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  it('returns cached artifacts on a 200 cache hit', async () => {
    nock(BASE_HOST)
      .get('/v0/orgs/test-org/full-scans/scan-1')
      .query({ cached: 'true' })
      .reply(200, NDJSON)

    const result = await fetchScan('test-org', 'scan-1')

    expect(result.ok).toBe(true)
    expect((result as { data: unknown[] }).data).toEqual([
      { type: 'npm', name: 'lodash', version: '4.17.21' },
      { type: 'npm', name: 'react', version: '18.2.0' },
    ])
  })

  it('polls on 202 until the cached result is ready', async () => {
    nock(BASE_HOST)
      .get('/v0/orgs/test-org/full-scans/scan-2')
      .query({ cached: 'true' })
      .reply(202, { status: 'processing', id: 'scan-2' })
    nock(BASE_HOST)
      .get('/v0/orgs/test-org/full-scans/scan-2')
      .query({ cached: 'true' })
      .reply(200, NDJSON)

    const result = await fetchScan('test-org', 'scan-2')

    expect(result.ok).toBe(true)
    expect((result as { data: unknown[] }).data).toHaveLength(2)
  })

  it('maps a 404 to a failed CResult', async () => {
    nock(BASE_HOST)
      .get('/v0/orgs/test-org/full-scans/missing')
      .query({ cached: 'true' })
      .reply(404, { error: { message: 'Not found' } })

    const result = await fetchScan('test-org', 'missing')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      message: 'Socket API error',
      data: { code: 404 },
    })
  })
})

describe('parseArtifactsNdjson', () => {
  it('parses one artifact per line, skipping blanks', () => {
    const result = parseArtifactsNdjson(NDJSON)
    expect(result).toEqual({
      ok: true,
      data: [
        { type: 'npm', name: 'lodash', version: '4.17.21' },
        { type: 'npm', name: 'react', version: '18.2.0' },
      ],
    })
  })

  it('returns an error when a line is not valid JSON', () => {
    const result = parseArtifactsNdjson('{"ok":true}\nnot-json\n')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ message: 'Invalid Socket API response' })
  })
})
