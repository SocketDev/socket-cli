import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseReleasePolicy,
  readReleasePolicy,
  readSeaReleaseConfig,
  seaVersionForManifestVersion,
} from '../../../src/sea/version.mts'

const temporaryRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'socket-sea-release-'))
  temporaryRoots.push(root)
  return root
}

async function writeConfig(root: string, filename: string, value: unknown) {
  if (filename.startsWith('.config/')) {
    await mkdir(path.join(root, '.config'))
  }
  await writeFile(path.join(root, filename), JSON.stringify(value))
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { force: true, recursive: true })),
  )
})

describe('release policy', () => {
  it('uses the release-prepared prerelease version for SEA builds', () => {
    const policy = {
      mode: 'prerelease-only' as const,
      versionHint: '2.1.0',
      identifier: 'rc',
      distTag: 'rc-2.1.0',
    }
    expect(seaVersionForManifestVersion('1.14.1', policy)).toBe('2.1.0-rc.0')
    expect(seaVersionForManifestVersion('2.1.0-rc.17', policy)).toBe(
      '2.1.0-rc.17',
    )
  })

  it.each(['2.1.0', '2.1.0-beta.1', '2.2.0-rc.1'])(
    'rejects a package version outside the prerelease policy: %s',
    version => {
      expect(() =>
        seaVersionForManifestVersion(version, {
          mode: 'prerelease-only',
          versionHint: '2.1.0',
          identifier: 'rc',
          distTag: 'rc-2.1.0',
        }),
      ).toThrow('does not match the configured SEA prerelease policy')
    },
  )

  it('accepts the configured rc track and its specific dist-tag', () => {
    expect(
      parseReleasePolicy({
        mode: 'prerelease-only',
        versionHint: '2.1.0',
        identifier: 'rc',
        distTag: 'rc-2.1.0',
      }),
    ).toEqual({
      mode: 'prerelease-only',
      versionHint: '2.1.0',
      identifier: 'rc',
      distTag: 'rc-2.1.0',
    })
  })

  it.each(['latest', 'next', 'rc', 'prerelease-2.2.0'])(
    'rejects %s for a prerelease-only track',
    distTag => {
      expect(() =>
        parseReleasePolicy({
          mode: 'prerelease-only',
          versionHint: '2.1.0',
          identifier: 'rc',
          distTag,
        }),
      ).toThrow('must use the rc-2.1.0 dist-tag')
    },
  )

  it('accepts the stable hint policy for non-SEA release flows', () => {
    expect(
      parseReleasePolicy({ mode: 'stable-from-hint', distTag: 'latest' }),
    ).toEqual({ mode: 'stable-from-hint', distTag: 'latest' })
  })

  it('requires an explicit release config for SEA builds', async () => {
    const root = await createRoot()

    expect(() => readSeaReleaseConfig(root)).toThrow(
      'Release configuration not found',
    )
  })

  it('requires the prerelease-only mode for SEA builds', async () => {
    const root = await createRoot()
    await writeConfig(root, 'release.json', {
      mode: 'stable-from-hint',
      distTag: 'latest',
    })

    expect(() => readSeaReleaseConfig(root)).toThrow(
      'Node SEA builds require a prerelease-only release policy',
    )
  })

  it('requires an explicit prerelease identifier', async () => {
    const root = await createRoot()
    await writeConfig(root, '.config/release.json', {
      mode: 'prerelease-only',
      versionHint: '2.1.0',
      distTag: 'rc-2.1.0',
    })

    expect(() => readSeaReleaseConfig(root)).toThrow(
      'Release policy mode must be',
    )
  })

  it.each(['.config/release.json', 'release.json', '.release.json'])(
    'reads an explicit config from %s',
    async filename => {
      const root = await createRoot()
      await writeConfig(root, filename, {
        mode: 'prerelease-only',
        versionHint: '2.1.0',
        identifier: 'rc',
        distTag: 'rc-2.1.0',
      })

      expect(readSeaReleaseConfig(root)).toEqual({
        mode: 'prerelease-only',
        versionHint: '2.1.0',
        identifier: 'rc',
        distTag: 'rc-2.1.0',
      })
    },
  )

  it('rejects conflicting release config paths', async () => {
    const root = await createRoot()
    const config = {
      mode: 'prerelease-only',
      versionHint: '2.1.0',
      identifier: 'rc',
      distTag: 'rc-2.1.0',
    }
    await Promise.all([
      writeConfig(root, '.config/release.json', config),
      writeConfig(root, 'release.json', config),
    ])

    expect(() => readSeaReleaseConfig(root)).toThrow(
      'Found multiple release configurations',
    )
  })
})
