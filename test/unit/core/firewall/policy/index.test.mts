import { describe, expect, it, vi } from 'vitest'

import { createFirewallPolicy } from '../../../../../src/core/firewall/policy/index.mts'

const artifactUrl =
  'https://registry.npmjs.org/example-module/-/example-module-1.2.3.tgz'
const artifactPurl = 'pkg:npm/example-module@1.2.3'

function policyResponse(alerts: unknown[] = []): Response {
  return new Response(
    JSON.stringify({
      name: 'example-module',
      type: 'npm',
      version: '1.2.3',
      inputPurl: artifactPurl,
      alerts,
    }),
  )
}

describe('firewall policy', () => {
  it('keeps custom host restrictions with trailing dots and alternate ports', async () => {
    const policy = createFirewallPolicy({
      customRegistries: ['npm:packages.example.com/npm'],
    })
    expect(
      policy.resolveDestination(new URL('https://packages.example.com.')),
    ).toBe('inspect')
    expect(
      await policy.checkRequest(
        new URL('https://packages.example.com./outside/example.tgz'),
        'GET',
      ),
    ).toMatchObject({ blocked: true })
    expect(
      await policy.checkRequest(
        new URL('https://packages.example.com:8443/outside/example.tgz'),
        'GET',
      ),
    ).toMatchObject({ blocked: true })
    expect(
      policy.resolveDestination(new URL('https://registry.npmjs.org:8443')),
    ).toBe('inspect')
  })
  it('uses the free endpoint without a credential and scans query-bearing downloads', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(policyResponse())
    const policy = createFirewallPolicy({ fetch })
    expect(
      await policy.checkRequest(new URL(`${artifactUrl}?download=1`), 'GET'),
    ).toMatchObject({ blocked: false })
    expect(fetch).toHaveBeenCalledWith(
      `https://firewall-api.socket.dev/purl/${encodeURIComponent(artifactPurl)}`,
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    )
    expect(policy.resolveDestination(new URL('https://example.com'))).toBe(
      'bypass',
    )
  })

  it('uses authenticated component objects and blocks unknown destinations', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(policyResponse())
    const policy = createFirewallPolicy({
      fetch,
      apiToken: 'example-placeholder-token',
    })
    await policy.checkRequest(new URL(artifactUrl), 'GET')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.socket.dev/v0/purl?alerts=true',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ components: [{ purl: artifactPurl }] }),
        headers: {
          authorization: 'Bearer example-placeholder-token',
          'content-type': 'application/json',
        },
      }),
    )
    expect(policy.resolveDestination(new URL('https://example.com'))).toBe(
      'block',
    )
  })

  it('blocks error actions and emits warning actions without inferring severity', async () => {
    const onWarning = vi.fn()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      policyResponse([
        { type: 'malware', action: 'error' },
        { type: 'networkAccess', action: 'warn' },
        { type: 'usesEval', action: 'monitor', severity: 'critical' },
      ]),
    )
    const policy = createFirewallPolicy({ fetch, onWarning })
    expect(await policy.checkRequest(new URL(artifactUrl), 'HEAD')).toEqual({
      blocked: true,
      reasons: ['error: malware', 'warn: networkAccess'],
    })
    expect(onWarning).toHaveBeenCalledOnce()
  })

  it.each([
    '',
    '{}',
    'not json',
    '{"name":"example-module","type":"npm","version":"1.2.3","alerts":null}',
  ])('fails closed for malformed API response %s', async body => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body))
    const policy = createFirewallPolicy({ fetch })
    expect(
      await policy.checkRequest(new URL(artifactUrl), 'GET'),
    ).toMatchObject({ blocked: true })
  })

  it('permits upstream synthetic not-found records without alerts', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: `synthetic:notFound:${artifactPurl}`,
          inputPurl: artifactPurl,
          name: 'example-module',
          type: 'npm',
          version: '1.2.3',
        }),
      ),
    )
    expect(
      await createFirewallPolicy({ fetch }).checkRequest(
        new URL(artifactUrl),
        'GET',
      ),
    ).toMatchObject({ blocked: false })
  })

  it('deduplicates concurrent checks and caches only successful evaluations', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(policyResponse())
    const policy = createFirewallPolicy({ fetch })
    await Promise.allSettled([
      policy.checkRequest(new URL(artifactUrl), 'GET'),
      policy.checkRequest(new URL(artifactUrl), 'GET'),
    ])
    await policy.checkRequest(new URL(artifactUrl), 'GET')
    expect(fetch).toHaveBeenCalledOnce()
    policy.close()
    expect(
      await policy.checkRequest(new URL(artifactUrl), 'GET'),
    ).toMatchObject({ blocked: true })
  })

  it('retries failed evaluations without caching allow-on-failure', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('example unavailable'))
    const policy = createFirewallPolicy({ fetch, failAction: 'ignore' })
    expect(
      await policy.checkRequest(new URL(artifactUrl), 'GET'),
    ).toMatchObject({ blocked: false })
    await policy.checkRequest(new URL(artifactUrl), 'GET')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('enforces custom prefix boundaries and inspects the CONNECT authority', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(policyResponse())
    const policy = createFirewallPolicy({
      fetch,
      customRegistries: ['npm:packages.example.com/npm'],
    })
    expect(
      policy.resolveDestination(new URL('https://packages.example.com')),
    ).toBe('inspect')
    expect(
      await policy.checkRequest(
        new URL(
          'https://packages.example.com/npm/example-module/-/example-module-1.2.3.tgz',
        ),
        'GET',
      ),
    ).toMatchObject({ blocked: false })
    expect(
      await policy.checkRequest(
        new URL(
          'https://packages.example.com/npm-extra/example-module/-/example-module-1.2.3.tgz',
        ),
        'GET',
      ),
    ).toMatchObject({ blocked: true })
    expect(
      await policy.checkRequest(
        new URL(
          'https://packages.example.com/npm%2fexample-module/-/example-module-1.2.3.tgz',
        ),
        'GET',
      ),
    ).toMatchObject({ blocked: true })
  })

  it.each([
    'npm:https://example.com@evil.example/npm',
    'npm:example.com/npm?query',
    'npm:example.com/npm#fragment',
    'npm:example.com/%2f',
    'invalid:example.com',
  ])('rejects ambiguous registry configuration %s', entry => {
    expect(() => createFirewallPolicy({ customRegistries: [entry] })).toThrow()
  })
})
