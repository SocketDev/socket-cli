/**
 * Unit tests for the MCP tools' Socket API layer.
 *
 * Covers the alerts query mapping, the What/Where/Saw/Fix error message shape,
 * the SDK-result envelope re-derivation, and the per-token SDK memoization.
 *
 * Related Files: - src/commands/mcp/lib/socket-api.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildSocketAlertsQuery,
  fetchSocketAlerts,
  fetchSocketOrganizations,
  fetchSocketPackageFileList,
  fetchSocketThreatFeed,
  resolveSocketSdkForToken,
  socketApiErrorMessage,
  toSocketApiResult,
  unwrapSocketApiResult,
} from '../../../../../src/commands/mcp/lib/socket-api.mts'

// The SDK can genuinely hand back a JSON null; parsing one models that
// faithfully and keeps a bare `null` literal out of the source.
const JSON_NULL: unknown = JSON.parse('null')

const { mockGetApi, mockGetThreatFeed, mockListOrganizations, mockSetupSdk } =
  vi.hoisted(() => ({
    mockGetApi: vi.fn(),
    mockGetThreatFeed: vi.fn(),
    mockListOrganizations: vi.fn(),
    mockSetupSdk: vi.fn(),
  }))

vi.mock(import('../../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: vi.fn(() => 'test_fake_token'),
  setupSdk: mockSetupSdk,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockListOrganizations.mockResolvedValue({
    data: { organizations: {} },
    status: 200,
    success: true,
  })
  mockSetupSdk.mockResolvedValue({
    data: {
      getApi: mockGetApi,
      getOrgThreatFeedItems: mockGetThreatFeed,
      listOrganizations: mockListOrganizations,
    },
    ok: true,
  })
})

describe('Socket API reads', () => {
  it.each([
    [{}, 'orgs/example%2Forg/alerts'],
    [
      { severity: 'high' },
      'orgs/example%2Forg/alerts?filters.alertSeverity=high',
    ],
  ])(
    'encodes the organization and forwards alert filters',
    async (filters, path) => {
      const data = { alerts: [{ type: 'usesEval' }] }
      mockGetApi.mockResolvedValueOnce({ data, status: 200, success: true })
      expect(
        await fetchSocketAlerts(
          'test_fake_alert_token',
          'example/org',
          filters,
        ),
      ).toEqual(data)
      expect(mockGetApi).toHaveBeenLastCalledWith(path, {
        responseType: 'json',
        throws: false,
      })
    },
  )

  it('encodes the complete PURL as one file-list path segment', async () => {
    const data = { files: [{ path: 'index.js' }] }
    mockGetApi.mockResolvedValueOnce({ data, status: 200, success: true })
    expect(
      await fetchSocketPackageFileList(
        'test_fake_files_token',
        'pkg:npm/@example/package@1.0.0',
      ),
    ).toEqual(data)
    expect(mockGetApi).toHaveBeenLastCalledWith(
      'purl/file-list/pkg%3Anpm%2F%40example%2Fpackage%401.0.0',
      { responseType: 'json', throws: false },
    )
  })

  it('rejects an unsuccessful file-list envelope', async () => {
    mockGetApi.mockResolvedValueOnce({ status: 403, success: false })
    await expect(
      fetchSocketPackageFileList(
        'test_fake_files_failure_token',
        'pkg:npm/example-package@1.0.0',
      ),
    ).rejects.toBeInstanceOf(Error)
  })

  it('passes threat-feed pagination to the SDK and returns its payload', async () => {
    const query = { cursor: 'example-cursor', per_page: 20 }
    const data = { items: [] }
    mockGetThreatFeed.mockResolvedValueOnce({
      data,
      status: 200,
      success: true,
    })
    expect(
      await fetchSocketThreatFeed('test_fake_feed_token', 'example-org', query),
    ).toEqual(data)
    expect(mockGetThreatFeed).toHaveBeenLastCalledWith('example-org', query)
  })

  it('rejects an unsuccessful threat-feed envelope', async () => {
    mockGetThreatFeed.mockResolvedValueOnce({
      error: 'Forbidden',
      status: 403,
      success: false,
    })
    await expect(
      fetchSocketThreatFeed('test_fake_feed_failure_token', 'example-org', {}),
    ).rejects.toBeInstanceOf(Error)
  })
})

describe('buildSocketAlertsQuery', () => {
  it('produces an empty query when nothing is set', () => {
    expect(buildSocketAlertsQuery({}).toString()).toBe('')
  })

  it('maps each filter onto its documented parameter', () => {
    const query = buildSocketAlertsQuery({
      alertType: 'usesEval',
      artifactName: 'lodash',
      artifactType: 'npm',
      category: 'quality',
      repoSlug: 'web',
      severity: 'high',
      status: 'open',
    })
    expect(query.get('filters.alertType')).toBe('usesEval')
    expect(query.get('filters.artifactName')).toBe('lodash')
    expect(query.get('filters.artifactType')).toBe('npm')
    expect(query.get('filters.alertCategory')).toBe('quality')
    expect(query.get('filters.repoSlug')).toBe('web')
    expect(query.get('filters.alertSeverity')).toBe('high')
    expect(query.get('filters.alertStatus')).toBe('open')
  })

  it('maps the cursor onto startAfterCursor', () => {
    expect(
      buildSocketAlertsQuery({ cursor: 'abc' }).get('startAfterCursor'),
    ).toBe('abc')
  })

  it('sets per_page only when it is a number', () => {
    expect(buildSocketAlertsQuery({ perPage: 25 }).get('per_page')).toBe('25')
    expect(buildSocketAlertsQuery({}).get('per_page')).toBeNull()
  })

  it('percent-encodes a value rather than letting it split the query', () => {
    expect(
      buildSocketAlertsQuery({ severity: 'high&admin=1' }).toString(),
    ).toContain('high%26admin%3D1')
  })
})

describe('socketApiErrorMessage', () => {
  it('names what, where, what it saw, and the fix', () => {
    const message = socketApiErrorMessage(
      'Listing Socket alerts',
      'GET /v0/orgs/acme/alerts',
      500,
      'upstream error',
    )
    expect(message).toContain('Listing Socket alerts failed')
    expect(message).toContain('Where: GET /v0/orgs/acme/alerts')
    expect(message).toContain('Saw: HTTP 500 (upstream error), wanted HTTP 200')
    expect(message).toContain('Fix:')
  })

  it('points a 401 at socket login', () => {
    expect(socketApiErrorMessage('x', 'y', 401, undefined)).toContain(
      'socket login',
    )
  })

  it('points a 403 at permissions', () => {
    expect(socketApiErrorMessage('x', 'y', 403, undefined)).toContain(
      'permissions',
    )
  })

  it('points a 404 at the organizations tool', () => {
    expect(socketApiErrorMessage('x', 'y', 404, undefined)).toContain(
      '`organizations` tool',
    )
  })

  it('handles a missing status', () => {
    expect(socketApiErrorMessage('x', 'y', undefined, undefined)).toContain(
      'no HTTP status',
    )
  })
})

describe('toSocketApiResult', () => {
  it('passes a success envelope through', () => {
    expect(
      toSocketApiResult({ data: { a: 1 }, status: 200, success: true }),
    ).toEqual({ data: { a: 1 }, status: 200, success: true })
  })

  it('passes a failure envelope through', () => {
    expect(
      toSocketApiResult({
        cause: 'nope',
        error: 'Forbidden',
        status: 403,
        success: false,
      }),
    ).toEqual({
      cause: 'nope',
      error: 'Forbidden',
      status: 403,
      success: false,
    })
  })

  it('defaults a missing status to 0 rather than trusting the envelope', () => {
    expect(toSocketApiResult({ success: true }).status).toBe(0)
  })

  it('supplies error text when the failure envelope omits it', () => {
    const result = toSocketApiResult({ success: false })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no error text')
  })

  it('drops a non-string cause', () => {
    const result = toSocketApiResult({ cause: 42, success: false })
    expect(result.cause).toBeUndefined()
  })

  it.each([
    ['a string', 'nope'],
    ['null', JSON_NULL],
    ['a bare object', {}],
  ])('treats %s as a failure rather than a silent success', (_label, value) => {
    const result = toSocketApiResult(value)
    expect(result.success).toBe(false)
  })
})

describe('unwrapSocketApiResult', () => {
  it('returns the data on success', () => {
    expect(
      unwrapSocketApiResult(
        { data: 'ok', status: 200, success: true },
        'w',
        'p',
      ),
    ).toBe('ok')
  })

  it('throws a composed message on failure', () => {
    expect(() =>
      unwrapSocketApiResult(
        { error: 'Forbidden', status: 403, success: false },
        'Listing orgs',
        'GET /v0/organizations',
      ),
    ).toThrow('Listing orgs failed')
  })

  it('prefers the cause over the error text', () => {
    expect(() =>
      unwrapSocketApiResult(
        {
          cause: 'token expired',
          error: 'Unauthorized',
          status: 401,
          success: false,
        },
        'w',
        'p',
      ),
    ).toThrow('token expired')
  })
})

describe('resolveSocketSdkForToken', () => {
  it('memoizes one SDK per token', async () => {
    const first = await resolveSocketSdkForToken('token_memo_a')
    const second = await resolveSocketSdkForToken('token_memo_a')
    expect(first).toBe(second)
    expect(mockSetupSdk).toHaveBeenCalledTimes(1)
  })

  it('builds a distinct SDK per distinct token', async () => {
    await resolveSocketSdkForToken('token_distinct_a')
    await resolveSocketSdkForToken('token_distinct_b')
    expect(mockSetupSdk).toHaveBeenCalledTimes(2)
  })

  it('throws when SDK setup fails', async () => {
    mockSetupSdk.mockResolvedValue({ cause: 'bad proxy', ok: false })
    await expect(resolveSocketSdkForToken('token_fail')).rejects.toThrow(
      'bad proxy',
    )
  })

  it.each([
    { message: 'Example SDK initialization failed', ok: false },
    { ok: false },
  ])('allows retry after SDK initialization fails', async failure => {
    const token = failure.message
      ? 'test_fake_retry_message_token'
      : 'test_fake_retry_empty_token'
    mockSetupSdk.mockResolvedValueOnce(failure)
    await expect(resolveSocketSdkForToken(token)).rejects.toBeInstanceOf(Error)
    const sdk = await resolveSocketSdkForToken(token)
    expect(sdk.listOrganizations).toBe(mockListOrganizations)
    expect(mockSetupSdk).toHaveBeenCalledTimes(2)
  })
})

describe('fetchSocketOrganizations', () => {
  it('returns the organizations payload', async () => {
    mockListOrganizations.mockResolvedValue({
      data: { organizations: { '1': { name: 'acme' } } },
      status: 200,
      success: true,
    })
    expect(await fetchSocketOrganizations('token_orgs_ok')).toEqual({
      organizations: { '1': { name: 'acme' } },
    })
  })

  it('throws a composed message on a failure envelope', async () => {
    mockListOrganizations.mockResolvedValue({
      error: 'Forbidden',
      status: 403,
      success: false,
    })
    await expect(fetchSocketOrganizations('token_orgs_403')).rejects.toThrow(
      'Listing Socket organizations failed',
    )
  })
})
