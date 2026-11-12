import { describe, expect, it, vi } from 'vitest'

import {
  waitForNpmVersion,
  waitForReleasePackages,
} from '../scripts/release/availability.mts'
import { releasePackagesForVersion } from '../scripts/release/packages.mts'

describe('npm release availability', () => {
  it('checks the exact encoded package version with HEAD and retries 404', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const wait = vi.fn(async () => {})

    await expect(
      waitForNpmVersion('@socketsecurity/cli', '1.14.2', {
        fetcher,
        wait,
      }),
    ).resolves.toBeUndefined()
    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      [
        'https://registry.npmjs.org/%40socketsecurity%2Fcli/1.14.2',
        'HEAD',
      ],
      [
        'https://registry.npmjs.org/%40socketsecurity%2Fcli/1.14.2',
        'HEAD',
      ],
    ])
    expect(wait).toHaveBeenCalledOnce()
  })

  it('waits for all stable package versions and only socket for prereleases', async () => {
    expect(releasePackagesForVersion('1.14.2')).toEqual([
      'socket',
      '@socketsecurity/cli',
      '@socketsecurity/cli-with-sentry',
    ])
    expect(releasePackagesForVersion('2.1.0-rc.2')).toEqual(['socket'])

    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }))
    await expect(
      waitForReleasePackages('1.14.2', { fetcher }),
    ).resolves.toEqual(releasePackagesForVersion('1.14.2'))
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('fails fast on registry errors other than pending or throttled responses', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }))
    await expect(
      waitForNpmVersion('socket', '2.1.0-rc.2', { fetcher }),
    ).rejects.toThrow('npm availability check returned HTTP 403')
  })

  it('honors Retry-After for throttled requests', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { 'retry-after': '5' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const wait = vi.fn(async () => {})

    await waitForNpmVersion('socket', '2.1.0-rc.2', { fetcher, wait })

    expect(wait).toHaveBeenCalledWith(5_000, undefined)
  })

  it('times out without creating a release when the public version stays absent', async () => {
    let currentTime = 0
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }))
    const wait = vi.fn(async (milliseconds: number) => {
      currentTime += milliseconds
    })

    await expect(
      waitForNpmVersion('socket', '2.1.0-rc.2', {
        fetcher,
        now: () => currentTime,
        timeoutMs: 3_000,
        wait,
      }),
    ).rejects.toThrow('no GitHub release was created')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
