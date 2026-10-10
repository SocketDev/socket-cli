import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  overrideCachedConfig,
  resetConfigForTesting,
} from '../../../../src/util/config.mts'
import {
  getDefaultApiBaseUrl,
  getDefaultApiToken,
  getDefaultProxyUrl,
  getVisibleTokenPrefix,
  hasDefaultApiToken,
  invalidateDefaultApiToken,
  resolveSdkCredential,
  setupSdk,
  supportsOAuthSdk,
} from '../../../../src/util/socket/sdk.mts'

beforeEach(() => {
  vi.stubEnv('SOCKET_CLI_API_PROXY', '')
  vi.stubEnv('HTTP_PROXY', '')
  vi.stubEnv('HTTPS_PROXY', '')
  vi.stubEnv('ALL_PROXY', '')
  vi.stubEnv('http_proxy', '')
  vi.stubEnv('https_proxy', '')
  overrideCachedConfig('{}')
  invalidateDefaultApiToken()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetConfigForTesting()
  invalidateDefaultApiToken()
})

describe('SDK credential configuration', () => {
  it('has no credentials or configured endpoint by default', () => {
    expect(getDefaultApiBaseUrl()).toBeUndefined()
    expect(getDefaultApiToken()).toBeUndefined()
    expect(getDefaultProxyUrl()).toBeUndefined()
    expect(getVisibleTokenPrefix()).toBe('')
    expect(hasDefaultApiToken()).toBe(false)
  })

  it('reads configured API credentials and endpoints', () => {
    overrideCachedConfig(
      JSON.stringify({
        apiToken: 'REDACTED_TEST_TOKEN',
        apiBaseUrl: 'https://api.example.com/v0/',
        apiProxy: 'https://proxy.example.com',
      }),
    )
    expect(getDefaultApiToken()).toBe('REDACTED_TEST_TOKEN')
    expect(getDefaultApiBaseUrl()).toBe('https://api.example.com/v0/')
    expect(getDefaultProxyUrl()).toBe('https://proxy.example.com')
    expect(hasDefaultApiToken()).toBe(true)
    expect(getVisibleTokenPrefix().length).toBe(5)
  })

  it('does not reuse cached credentials after config removal', () => {
    overrideCachedConfig(JSON.stringify({ apiToken: 'REDACTED_TEST_TOKEN' }))
    expect(getDefaultApiToken()).toBe('REDACTED_TEST_TOKEN')
    overrideCachedConfig('{}')
    expect(getDefaultApiToken()).toBeUndefined()
  })

  it('uses environment API credentials before persisted credentials', () => {
    overrideCachedConfig(JSON.stringify({ apiToken: 'REDACTED_STORED_TOKEN' }))
    vi.stubEnv('SOCKET_API_TOKEN', 'REDACTED_ENV_TOKEN')
    expect(getDefaultApiToken()).toBe('REDACTED_ENV_TOKEN')
  })

  it('honors the explicit no-token setting', () => {
    overrideCachedConfig(JSON.stringify({ apiToken: 'REDACTED_TEST_TOKEN' }))
    vi.stubEnv('SOCKET_CLI_NO_API_TOKEN', '1')
    expect(getDefaultApiToken()).toBeUndefined()
  })

  it.each(['https://127.0.0.1/v0/', 'http://169.254.169.254/v0/'])(
    'refuses private credential destinations: %s',
    apiBaseUrl => {
      overrideCachedConfig(JSON.stringify({ apiBaseUrl }))
      expect(() => getDefaultApiBaseUrl()).toThrow()
    },
  )

  it('ignores malformed optional endpoints', () => {
    overrideCachedConfig(
      JSON.stringify({ apiBaseUrl: 'invalid', apiProxy: 'invalid' }),
    )
    expect(getDefaultApiBaseUrl()).toBeUndefined()
    expect(getDefaultProxyUrl()).toBeUndefined()
  })

  it('creates a real SDK without making a request', async () => {
    const result = await setupSdk({ apiToken: 'REDACTED_TEST_TOKEN' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.data.listOrganizations).toBe('function')
    }
  })

  it('returns an authentication result without credentials', async () => {
    expect((await setupSdk()).ok).toBe(false)
  })

  it('keeps API token mode independent of OAuth capability', () => {
    expect(supportsOAuthSdk('basic')).toBe(true)
  })

  it('selects explicit bearer verification credentials', async () => {
    expect(
      await resolveSdkCredential({
        apiToken: 'REDACTED_ACCESS_TOKEN',
        authScheme: 'bearer',
      }),
    ).toMatchObject({
      ok: true,
      data: { authScheme: 'bearer', token: 'REDACTED_ACCESS_TOKEN' },
    })
  })
})
