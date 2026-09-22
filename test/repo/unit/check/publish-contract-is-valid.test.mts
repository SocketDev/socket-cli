import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  version: '2.2.0-prerelease',
  tag: 'prerelease',
  source: {
    date: '2026-09-22',
    sha: '0123456789abcdef0123456789abcdef01234567',
    version: '2.2.0-prerelease.20260922-0123456',
  },
}))

vi.mock('node:fs', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: () =>
    JSON.stringify({
      name: 'socket',
      version: fixture.version,
      publishConfig: { tag: fixture.tag },
    }),
}))
vi.mock('../../../../scripts/fleet/paths.mts', () => ({
  PACKAGE_JSON: '/example/package.json',
  loadSocketWheelhouseConfig: () => ({
    value: { release: { publishedPackages: ['socket'] } },
  }),
}))
vi.mock('../../../../scripts/repo/bump.mts', () => ({
  cliReleaseSource: async () => fixture.source,
}))
vi.mock('@socketsecurity/lib-stable/env/rewire', () => ({
  getEnvValue: () => undefined,
}))

import { main } from '../../../../scripts/repo/check/publish-contract-is-valid.mts'

describe('CLI publish contract', () => {
  beforeEach(() => {
    fixture.tag = 'prerelease'
    fixture.version = '2.2.0-prerelease'
  })

  it('accepts a committed prerelease source', async () => {
    await expect(main()).resolves.toBeUndefined()
  })

  it('rejects publishing the prerelease source as latest', async () => {
    fixture.tag = 'latest'
    await expect(main()).rejects.toThrow()
  })

  it('rejects a stable manifest on the prerelease line', async () => {
    fixture.version = '2.2.0'
    await expect(main()).rejects.toThrow()
  })
})
