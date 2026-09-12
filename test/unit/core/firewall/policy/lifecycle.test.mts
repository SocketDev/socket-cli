import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFirewallPolicy } from '../../../../../src/core/firewall/policy/index.mts'

function artifactUrl(version = '1.2.3'): URL {
  return new URL(
    `https://registry.npmjs.org/example-module/-/example-module-${version}.tgz`,
  )
}

function responseForVersion(version: string): Response {
  return new Response(
    JSON.stringify({
      name: 'example-module',
      type: 'npm',
      version,
      alerts: [],
    }),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('firewall policy lifecycle', () => {
  it.each([401, 403])(
    'blocks authentication HTTP %s despite allow-on-failure',
    async status => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response('rejected', { status }))
      const policy = createFirewallPolicy({
        fetch,
        apiToken: 'example-placeholder-token',
        failAction: 'ignore',
      })
      expect(await policy.checkRequest(artifactUrl(), 'GET')).toMatchObject({
        blocked: true,
      })
      policy.close()
    },
  )

  it('expires cached decisions after sixty seconds', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => responseForVersion('1.2.3'))
    const policy = createFirewallPolicy({ fetch })
    await policy.checkRequest(artifactUrl(), 'GET')
    now.mockReturnValue(159_999)
    await policy.checkRequest(artifactUrl(), 'GET')
    expect(fetch).toHaveBeenCalledOnce()
    now.mockReturnValue(160_000)
    await policy.checkRequest(artifactUrl(), 'GET')
    expect(fetch).toHaveBeenCalledTimes(2)
    policy.close()
  })

  it('evicts the least recently used decision at capacity', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async url => {
        const purl = decodeURIComponent(
          (url instanceof Request ? url.url : url.toString()).split(
            '/purl/',
          )[1]!,
        )
        return responseForVersion(purl.split('@')[1]!)
      })
    const policy = createFirewallPolicy({ fetch, cacheCapacity: 2 })
    for (const version of ['1.2.3', '1.2.4', '1.2.3', '1.2.5', '1.2.3']) {
      expect(
        await policy.checkRequest(artifactUrl(version), 'GET'),
      ).toMatchObject({ blocked: false })
    }
    expect(fetch).toHaveBeenCalledTimes(3)
    await policy.checkRequest(artifactUrl('1.2.4'), 'GET')
    expect(fetch).toHaveBeenCalledTimes(4)
    policy.close()
  })

  it('blocks excess pending requests even when API failures are allowed', async () => {
    let finish: ((response: Response) => void) | undefined
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    const policy = createFirewallPolicy({
      fetch,
      cacheCapacity: 1,
      failAction: 'ignore',
    })
    const first = policy.checkRequest(artifactUrl(), 'GET')
    expect(
      await policy.checkRequest(artifactUrl('1.2.4'), 'GET'),
    ).toMatchObject({ blocked: true })
    expect(fetch).toHaveBeenCalledOnce()
    finish!(responseForVersion('1.2.3'))
    expect(await first).toMatchObject({ blocked: false })
    policy.close()
  })

  it('aborts in-flight evaluations on close without applying allow-on-failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (url, options) =>
        new Promise((resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(options!.signal!.reason),
            { once: true },
          )
        }),
    )
    const policy = createFirewallPolicy({ fetch, failAction: 'ignore' })
    const first = policy.checkRequest(artifactUrl(), 'GET')
    policy.close()
    expect(await first).toMatchObject({ blocked: true })
    expect(await policy.checkRequest(artifactUrl(), 'GET')).toMatchObject({
      blocked: true,
    })
  })

  it('warns on an allowed API failure and retries the next request', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('example failure'))
    const onWarning = vi.fn()
    const policy = createFirewallPolicy({
      fetch,
      failAction: 'warn',
      onWarning,
    })
    expect(await policy.checkRequest(artifactUrl(), 'GET')).toMatchObject({
      blocked: false,
    })
    expect(onWarning).toHaveBeenCalledOnce()
    await policy.checkRequest(artifactUrl(), 'GET')
    expect(fetch).toHaveBeenCalledTimes(2)
    policy.close()
  })

  it('rejects unsafe destinations and methods before invoking the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const policy = createFirewallPolicy({
      fetch,
      customRegistries: ['npm:packages.example.com/npm'],
    })
    for (const url of [
      'ftp://registry.npmjs.org/example.tgz',
      'https://user:password@registry.npmjs.org/example.tgz',
      'https://packages.example.com/',
    ]) {
      expect(await policy.checkRequest(new URL(url), 'GET')).toMatchObject({
        blocked: true,
      })
    }
    expect(await policy.checkRequest(artifactUrl(), 'POST')).toMatchObject({
      blocked: true,
    })
    expect(
      await policy.checkRequest(
        new URL('https://registry.npmjs.org/example-module'),
        'GET',
      ),
    ).toMatchObject({ blocked: false })
    expect(fetch).not.toHaveBeenCalled()
    policy.close()
  })

  it.each([
    { cacheCapacity: 0 },
    { cacheCapacity: 1.5 },
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
  ])('rejects invalid limits %o', options => {
    expect(() => createFirewallPolicy(options)).toThrow(RangeError)
  })
})
