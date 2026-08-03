/**
 * Unit tests for Socket API base URL resolution.
 *
 * Purpose: Tests how `getDefaultApiBaseUrl` resolves the endpoint that receives
 * `Authorization: Basic <token>` — env var, config key, public default — and
 * the SSRF guard that refuses private / link-local hosts and non-http(s)
 * schemes unless the operator allowlists the hostname.
 *
 * Related Files: - util/socket/api-http.mts (implementation) -
 * util/socket/safe-base-url.mts (guard) - api.test.mts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the SDK module to keep this suite off the SDK import chain.
vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  getDefaultApiToken: vi.fn(),
  getExtraCaCerts: () => undefined,
}))

import { overrideCachedConfig } from '../../../../src/util/config.mts'
import { getDefaultApiBaseUrl } from '../../../../src/util/socket/api-http.mts'

describe('getDefaultApiBaseUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    delete process.env['SOCKET_CLI_API_BASE_URL']
    overrideCachedConfig('{}')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns environment variable when set', () => {
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'https://custom.api.url')
    expect(getDefaultApiBaseUrl()).toBe('https://custom.api.url')
  })

  it('falls back to config value when env not set', () => {
    overrideCachedConfig('{"apiBaseUrl": "https://config.api.url"}')
    expect(getDefaultApiBaseUrl()).toBe('https://config.api.url')
  })

  it('returns default API_V0_URL when neither env nor config set', () => {
    expect(getDefaultApiBaseUrl()).toBe('https://api.socket.dev/v0/')
  })

  it('refuses an RFC-1918 host from the environment', () => {
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'https://10.0.0.5/v0/')
    expect(() => getDefaultApiBaseUrl()).toThrow(
      /Socket API base URL is refused/,
    )
  })

  it('refuses the cloud metadata address from config', () => {
    overrideCachedConfig('{"apiBaseUrl": "http://169.254.169.254/v0/"}')
    expect(() => getDefaultApiBaseUrl()).toThrow(
      /Socket API base URL is refused/,
    )
  })

  it('refuses loopback from the environment', () => {
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'http://127.0.0.1:3000/v0/')
    expect(() => getDefaultApiBaseUrl()).toThrow(
      /Socket API base URL is refused/,
    )
  })

  it('refuses a non-http(s) scheme', () => {
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'file:///etc/passwd')
    expect(() => getDefaultApiBaseUrl()).toThrow(/must use http\(s\)/)
  })

  it('names the env var, the config key, and the escape hatch in the refusal', () => {
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'https://10.0.0.5/v0/')
    expect(() => getDefaultApiBaseUrl()).toThrow(/SOCKET_CLI_API_BASE_URL/)
    expect(() => getDefaultApiBaseUrl()).toThrow(/apiBaseUrl/)
    expect(() => getDefaultApiBaseUrl()).toThrow(
      /SOCKET_CLI_ALLOWED_PRIVATE_HOSTS/,
    )
  })

  it('permits a private host listed in SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', () => {
    vi.stubEnv('SOCKET_CLI_API_BASE_URL', 'https://10.0.0.5/v0/')
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', '10.0.0.5')
    expect(getDefaultApiBaseUrl()).toBe('https://10.0.0.5/v0/')
  })
})
