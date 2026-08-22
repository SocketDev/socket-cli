/**
 * Unit tests split out of attempt-device-login.test.mts for size hygiene:
 * the base-URL / client-id resolvers, and the proxy-routing path
 * (postFormViaProxy), which need their own node:https mock.
 *
 * Related Files: - src/commands/login/attempt-device-login.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHttpRequest } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/http-request/request'), () => ({
  httpRequest: mockHttpRequest,
}))

const mockOpen = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock(import('open'), () => ({ default: mockOpen }))

// Fakes the proxy-path request node:https.request builds in
// postFormViaProxy - each test configures its own responses via
// mockImplementationOnce().
function fakeHttpsResponse(status: number, body: unknown) {
  return (
    _url: unknown,
    _options: unknown,
    callback: (res: unknown) => void,
  ) => {
    const res = {
      statusCode: status,
      on: (event: string, handler: (arg?: unknown | undefined) => void) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify(body)))
        } else if (event === 'end') {
          handler()
        }
      },
    }
    callback(res)
    return { on: () => {}, write: () => {}, end: () => {} }
  }
}
const mockHttpsRequest = vi.hoisted(() => vi.fn())
vi.mock(import('node:https'), () => ({ request: mockHttpsRequest }))

const mockSleep = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock(import('node:timers/promises'), () => ({ setTimeout: mockSleep }))

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

const mockSpinner = vi.hoisted(() => ({
  failAndStop: vi.fn(),
  start: vi.fn(),
  successAndStop: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: () => mockSpinner,
}))

const mockGetSocketCliOauthBaseUrl = vi.hoisted(() => vi.fn(() => ''))
vi.mock(import('../../../../src/env/socket-cli-oauth-base-url.mts'), () => ({
  getSocketCliOauthBaseUrl: mockGetSocketCliOauthBaseUrl,
}))

const mockGetSocketCliOauthClientIdOverride = vi.hoisted(() => vi.fn(() => ''))
vi.mock(import('../../../../src/env/socket-cli-oauth-client-id.mts'), () => ({
  getSocketCliOauthClientIdOverride: mockGetSocketCliOauthClientIdOverride,
}))

const mockApplyLogin = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/commands/login/apply-login.mts'), () => ({
  applyLogin: mockApplyLogin,
}))

const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetDefaultProxyUrl = vi.hoisted(() => vi.fn(() => undefined))
vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultProxyUrl: mockGetDefaultProxyUrl,
  setupSdk: mockSetupSdk,
}))

const mockUpdateConfigValue = vi.hoisted(() => vi.fn())
const mockIsConfigFromFlag = vi.hoisted(() => vi.fn(() => false))
vi.mock(import('../../../../src/util/config.mts'), () => ({
  isConfigFromFlag: mockIsConfigFromFlag,
  updateConfigValue: mockUpdateConfigValue,
}))

const mockFetchOrganization = vi.hoisted(() => vi.fn())
vi.mock(
  import('../../../../src/commands/organization/fetch-organization-list.mts'),
  () => ({
    fetchOrganization: mockFetchOrganization,
  }),
)

const mockGetEnterpriseOrgs = vi.hoisted(() => vi.fn())
const mockGetOrgSlugs = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/organization.mts'), () => ({
  getEnterpriseOrgs: mockGetEnterpriseOrgs,
  getOrgSlugs: mockGetOrgSlugs,
}))

import {
  attemptDeviceLogin,
  resolveOauthBaseUrl,
  resolveOauthClientId,
} from '../../../../src/commands/login/attempt-device-login.mts'

const DEVICE_AUTH_BODY = {
  device_code: 'device-code-123',
  expires_in: 900,
  interval: 5,
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://socket.dev/oauth/device',
  verification_uri_complete:
    'https://socket.dev/oauth/device?user_code=ABCD-EFGH',
}

describe('resolveOauthBaseUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the built-in default when unset', () => {
    mockGetSocketCliOauthBaseUrl.mockReturnValueOnce('')
    expect(resolveOauthBaseUrl()).toBe('https://api.socket.dev/v1/oauth2/')
  })

  it('honors the env override', () => {
    mockGetSocketCliOauthBaseUrl.mockReturnValueOnce(
      'https://staging.example.com/v1/oauth2/',
    )
    expect(resolveOauthBaseUrl()).toBe('https://staging.example.com/v1/oauth2/')
  })
})

describe('resolveOauthClientId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the built-in default when unset', () => {
    mockGetSocketCliOauthClientIdOverride.mockReturnValueOnce('')
    expect(resolveOauthClientId()).toBe('socket-cli')
  })

  it('honors the env override', () => {
    mockGetSocketCliOauthClientIdOverride.mockReturnValueOnce('custom-client')
    expect(resolveOauthClientId()).toBe('custom-client')
  })
})

describe('attemptDeviceLogin proxy routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockGetSocketCliOauthBaseUrl.mockReturnValue('')
    mockGetSocketCliOauthClientIdOverride.mockReturnValue('')
    mockGetDefaultProxyUrl.mockReturnValue(undefined)
    mockIsConfigFromFlag.mockReturnValue(false)
    mockGetOrgSlugs.mockReturnValue(['my-org'])
    mockGetEnterpriseOrgs.mockReturnValue([])
    mockFetchOrganization.mockResolvedValue({
      ok: true,
      data: { organizations: [{ id: 'org-id', name: 'my-org' }] },
    })
    mockSetupSdk.mockResolvedValue({ ok: true, data: {} })
  })

  it('routes device-authorization and token requests through a configured proxy', async () => {
    mockHttpsRequest
      .mockImplementationOnce(fakeHttpsResponse(200, DEVICE_AUTH_BODY))
      .mockImplementationOnce(
        fakeHttpsResponse(200, {
          access_token: 'sktsec_abc',
          token_type: 'Bearer',
          expires_in: 900,
        }),
      )

    const result = await attemptDeviceLogin(
      undefined,
      'http://proxy.example:8080',
    )

    expect(result).toMatchObject({ ok: true })
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2)
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })
})
