/**
 * Unit tests for attemptDeviceLogin and its helpers.
 *
 * Mocks @socketsecurity/lib/http-request so the device-authorization and
 * token endpoints can be controlled per-test, `open` so no real browser
 * launches, and node:timers/promises so polling doesn't actually sleep.
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

import { attemptDeviceLogin } from '../../../../src/commands/login/attempt-device-login.mts'

function fakeResponse(opts: { status: number; body: unknown }) {
  const text = JSON.stringify(opts.body)
  return { status: opts.status, text: () => text }
}

const DEVICE_AUTH_BODY = {
  device_code: 'device-code-123',
  expires_in: 900,
  interval: 5,
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://socket.dev/oauth/device',
  verification_uri_complete:
    'https://socket.dev/oauth/device?user_code=ABCD-EFGH',
}

describe('attemptDeviceLogin', () => {
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

  it('returns an error when the OAuth base URL is unsafe', async () => {
    mockGetSocketCliOauthBaseUrl.mockReturnValue('http://169.254.169.254/')

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({
      ok: false,
      message: 'Invalid OAuth base URL',
    })
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('returns an error when device-authorization fails', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 400,
        body: { error: 'invalid_scope' },
      }),
    )

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({
      ok: false,
      message: 'Device authorization request failed',
    })
    expect(mockSpinner.failAndStop).toHaveBeenCalled()
  })

  it('prints the code and opens the browser on success', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
            refresh_token: 'refresh-abc',
            scope: 'packages:list',
          },
        }),
      )

    await attemptDeviceLogin(undefined, undefined)

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('ABCD-EFGH'),
    )
    expect(mockOpen).toHaveBeenCalledWith(
      DEVICE_AUTH_BODY.verification_uri_complete,
    )
  })

  it('polls through authorization_pending to a token', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ status: 400, body: { error: 'authorization_pending' } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: true })
    expect(mockSleep).toHaveBeenCalledTimes(2)
    expect(mockApplyLogin).toHaveBeenCalledWith(
      'sktsec_abc',
      [],
      undefined,
      undefined,
    )
  })

  it('honors slow_down by increasing the poll interval', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ status: 400, body: { error: 'slow_down' } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )

    await attemptDeviceLogin(undefined, undefined)

    expect(mockSleep).toHaveBeenNthCalledWith(1, 5000)
    expect(mockSleep).toHaveBeenNthCalledWith(2, 10_000)
  })

  it('returns an error when the device code expires', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { ...DEVICE_AUTH_BODY, expires_in: -1 },
      }),
    )

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'Device login failed' })
    expect(mockHttpRequest).toHaveBeenCalledTimes(1)
  })

  it('returns an error when access_denied is returned', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ status: 400, body: { error: 'access_denied' } }),
      )

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'Device login failed' })
  })

  it('propagates a setupSdk failure', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )
    mockSetupSdk.mockResolvedValueOnce({
      ok: false,
      message: 'SDK error',
      cause: 'bad token',
    })

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'SDK error' })
    expect(mockApplyLogin).not.toHaveBeenCalled()
  })

  it('propagates a fetchOrganization failure', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )
    mockFetchOrganization.mockResolvedValueOnce({
      ok: false,
      message: 'fetch failed',
      cause: 'no auth',
    })

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: false, message: 'fetch failed' })
  })

  it('fails when the account has no organizations', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )
    mockGetOrgSlugs.mockReturnValueOnce([])

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('No organizations'),
    })
  })

  it('enforces the single enterprise org', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )
    mockGetEnterpriseOrgs.mockReturnValueOnce([{ id: 'enterprise-org' }])

    await attemptDeviceLogin(undefined, undefined)

    expect(mockApplyLogin).toHaveBeenCalledWith(
      'sktsec_abc',
      ['enterprise-org'],
      undefined,
      undefined,
    )
  })

  it('tolerates a browser-open failure', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )
    mockOpen.mockRejectedValueOnce(new Error('no display'))

    const result = await attemptDeviceLogin(undefined, undefined)

    expect(result).toMatchObject({ ok: true })
  })

  it('sets process.exitCode and logs failure through logger.fail', async () => {
    mockHttpRequest.mockResolvedValueOnce(
      fakeResponse({ status: 400, body: { error: 'invalid_scope' } }),
    )

    await attemptDeviceLogin(undefined, undefined)

    expect(process.exitCode).toBe(1)
    expect(mockLogger.fail).toHaveBeenCalledWith(
      'Device authorization request failed',
    )
  })

  it('defaults to a 5 second poll interval when the server omits one', async () => {
    const { interval: _interval, ...bodyWithoutInterval } = DEVICE_AUTH_BODY
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: bodyWithoutInterval }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )

    await attemptDeviceLogin(undefined, undefined)

    expect(mockSleep).toHaveBeenCalledWith(5000)
  })

  it('persists the default org after a successful login', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )

    await attemptDeviceLogin(undefined, undefined)

    expect(mockUpdateConfigValue).toHaveBeenCalledWith(
      expect.any(String),
      'my-org',
    )
  })

  it('warns when config is in read-only mode (flag override)', async () => {
    mockHttpRequest
      .mockResolvedValueOnce(
        fakeResponse({ status: 200, body: DEVICE_AUTH_BODY }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          body: {
            access_token: 'sktsec_abc',
            token_type: 'Bearer',
            expires_in: 900,
          },
        }),
      )
    mockIsConfigFromFlag.mockReturnValueOnce(true)

    await attemptDeviceLogin(undefined, undefined)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('read-only'),
    )
  })
})
