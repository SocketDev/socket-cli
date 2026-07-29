/**
 * Unit tests for the operator-endpoint SSRF guard.
 *
 * Purpose: Validates that `assertSafeEndpointUrl` accepts public http(s)
 * endpoints, refuses private / link-local hosts and non-http(s) schemes, and
 * only relaxes the private-host refusal for a hostname the operator listed in
 * SOCKET_CLI_ALLOWED_PRIVATE_HOSTS.
 *
 * Related Files: - util/url/safe-endpoint.mts (implementation) -
 * env/socket-cli-allowed-private-hosts.mts (escape hatch)
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertSafeEndpointUrl,
  isAllowedPrivateEndpointUrl,
} from '../../../../src/util/url/safe-endpoint.mts'

describe('assertSafeEndpointUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts a public https URL', () => {
    const url = assertSafeEndpointUrl('https://api.socket.dev/v0/', {
      label: 'Socket API base URL',
    })
    expect(url.href).toBe('https://api.socket.dev/v0/')
  })

  it('refuses an RFC-1918 host', () => {
    expect(() =>
      assertSafeEndpointUrl('https://10.0.0.5/v0/', {
        label: 'Socket API base URL',
        source: 'SOCKET_CLI_API_BASE_URL',
      }),
    ).toThrow(/Socket API base URL is refused/)
  })

  it('refuses the cloud metadata address', () => {
    expect(() =>
      assertSafeEndpointUrl('http://169.254.169.254/latest/meta-data', {
        label: 'Socket API base URL',
      }),
    ).toThrow(/private\/loopback host/)
  })

  it('refuses loopback', () => {
    expect(() =>
      assertSafeEndpointUrl('http://127.0.0.1:3000/', {
        label: 'Socket API base URL',
      }),
    ).toThrow(/refused/)
  })

  it('refuses a non-http(s) scheme', () => {
    expect(() =>
      assertSafeEndpointUrl('file:///etc/passwd', {
        label: 'Socket API base URL',
      }),
    ).toThrow(/must use http\(s\)/)
  })

  it('refuses a value that is not a URL', () => {
    expect(() =>
      assertSafeEndpointUrl('not-a-url', { label: 'Socket API base URL' }),
    ).toThrow(/is not a valid URL/)
  })

  it('names the source and the escape hatch in the refusal', () => {
    expect(() =>
      assertSafeEndpointUrl('https://10.0.0.5/v0/', {
        label: 'Socket API base URL',
        source: 'the SOCKET_CLI_API_BASE_URL env var',
      }),
    ).toThrow(/SOCKET_CLI_ALLOWED_PRIVATE_HOSTS/)
  })

  it('permits an allowlisted private host', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', '10.0.0.5')
    const url = assertSafeEndpointUrl('https://10.0.0.5/v0/', {
      label: 'Socket API base URL',
    })
    expect(url.href).toBe('https://10.0.0.5/v0/')
  })

  it('permits an allowlisted private host over http on a port', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', ' 10.0.0.5 , 10.0.0.6 ')
    const url = assertSafeEndpointUrl('http://10.0.0.6:8080/v0/', {
      label: 'Socket API base URL',
    })
    expect(url.href).toBe('http://10.0.0.6:8080/v0/')
  })

  it('does not let the allowlist rescue a different private host', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', '10.0.0.5')
    expect(() =>
      assertSafeEndpointUrl('http://169.254.169.254/', {
        label: 'Socket API base URL',
      }),
    ).toThrow(/refused/)
  })

  it('does not let the allowlist rescue a non-http(s) scheme', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', 'localhost')
    expect(() =>
      assertSafeEndpointUrl('ftp://localhost/', {
        label: 'Socket API base URL',
      }),
    ).toThrow(/must use http\(s\)/)
  })
})

describe('isAllowedPrivateEndpointUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is false when the allowlist is unset', () => {
    expect(isAllowedPrivateEndpointUrl('https://10.0.0.5/')).toBe(false)
  })

  it('is false for a public host even when allowlisted', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', 'api.socket.dev')
    expect(isAllowedPrivateEndpointUrl('https://api.socket.dev/')).toBe(false)
  })

  it('is false for an unparseable value', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', 'localhost')
    expect(isAllowedPrivateEndpointUrl('not-a-url')).toBe(false)
  })

  it('matches the hostname case-insensitively', () => {
    vi.stubEnv('SOCKET_CLI_ALLOWED_PRIVATE_HOSTS', 'LocalHost')
    expect(isAllowedPrivateEndpointUrl('http://LOCALHOST:3000/')).toBe(true)
  })
})
