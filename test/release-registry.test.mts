import { describe, expect, it, vi } from 'vitest'

import {
  RELEASE_PACKAGES,
  assertReleaseVersionsAvailable,
  readPublishedVersion,
} from '../scripts/release/registry.mts'

describe('release registry preflight', () => {
  it('checks the exact version of all three packages and accepts only absence', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('', { status: 404 }),
    )
    const version = '1.1.177'
    await expect(
      assertReleaseVersionsAvailable(version, fetcher),
    ).resolves.toEqual({
      packages: [...RELEASE_PACKAGES],
      version,
    })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(
      RELEASE_PACKAGES.map(
        name =>
          `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
      ),
    )
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    }
  })

  it.each(RELEASE_PACKAGES)(
    'refuses a version already published as %s',
    async publishedPackage => {
      const fetcher = vi.fn<typeof fetch>(async url => {
        if (String(url).includes(encodeURIComponent(publishedPackage) + '/')) {
          return Response.json({ name: publishedPackage, version: '1.1.177' })
        }
        return new Response('', { status: 404 })
      })
      await expect(
        assertReleaseVersionsAvailable('1.1.177', fetcher),
      ).rejects.toMatchObject({
        code: 'VERSION_ALREADY_PUBLISHED',
        status: 200,
      })
      expect(fetcher).toHaveBeenCalledTimes(3)
    },
  )

  it.each([401, 403, 429, 500, 503])(
    'refuses HTTP %i instead of treating it as absence',
    async status => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response('', { status }),
      )
      await expect(
        assertReleaseVersionsAvailable('1.1.177', fetcher),
      ).rejects.toMatchObject({
        code: 'REGISTRY_HTTP_ERROR',
        status,
      })
      expect(fetcher).toHaveBeenCalledTimes(3)
    },
  )

  it('refuses a network failure', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fixture network failure'))
    await expect(
      assertReleaseVersionsAvailable('1.1.177', fetcher),
    ).rejects.toMatchObject({
      code: 'REGISTRY_REQUEST_FAILED',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('refuses invalid JSON in a successful response', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('<html>fixture</html>'),
    )
    await expect(
      assertReleaseVersionsAvailable('1.1.177', fetcher),
    ).rejects.toMatchObject({
      code: 'REGISTRY_INVALID_RESPONSE',
      status: 200,
    })
  })

  it.each([
    null,
    [],
    {},
    { name: 'socket', version: '1.1.176' },
    { name: 'fixture-package', version: '1.1.177' },
  ])('refuses malformed successful version documents: %j', async document => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(document))
    await expect(
      assertReleaseVersionsAvailable('1.1.177', fetcher),
    ).rejects.toMatchObject({
      code: 'REGISTRY_INVALID_RESPONSE',
      status: 200,
    })
  })

  it.each(['', 'v1.1.177', '1.1', '1.1.177-prerelease', '../latest'])(
    'rejects a non-release version before making requests: %s',
    async version => {
      const fetcher = vi.fn<typeof fetch>()
      await expect(
        assertReleaseVersionsAvailable(version, fetcher),
      ).rejects.toBeInstanceOf(TypeError)
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
})

describe('published version anchor', () => {
  it('returns the validated latest version', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ 'dist-tags': { latest: '1.1.176' } }),
    )
    await expect(readPublishedVersion('socket', fetcher)).resolves.toBe(
      '1.1.176',
    )
  })

  it('allows an absent package only on HTTP 404', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('', { status: 404 }),
    )
    await expect(
      readPublishedVersion('socket', fetcher),
    ).resolves.toBeUndefined()
  })

  it.each([{}, { 'dist-tags': {} }, { 'dist-tags': { latest: 'invalid' } }])(
    'refuses a missing or invalid latest: %j',
    async document => {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(document))
      await expect(
        readPublishedVersion('socket', fetcher),
      ).rejects.toMatchObject({
        code: 'REGISTRY_INVALID_RESPONSE',
        status: 200,
      })
    },
  )
})
