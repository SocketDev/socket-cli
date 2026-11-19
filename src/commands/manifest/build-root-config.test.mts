import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBuildRootSettingsResolver,
  describeDisabledBy,
  displayPath,
} from './build-root-config.mts'
import { InputError } from '../../utils/errors.mts'
import { logger } from '../../utils/logger.mts'

describe('createBuildRootSettingsResolver', () => {
  let scanRoot = ''

  const write = async (
    rel: string,
    manifest: unknown,
    files: string[] = [],
  ) => {
    const dir = path.join(scanRoot, rel)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'socket.json'),
      JSON.stringify({ version: 1, defaults: { manifest } }),
    )
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(dir, file), '')
    }
  }
  const maven = (dir: string, entryFile = 'pom.xml') => ({
    dir: path.join(scanRoot, dir),
    entryFile,
  })

  beforeEach(async () => {
    scanRoot = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'build-root-config-')),
    )
  })
  afterEach(async () => {
    await fs.rm(scanRoot, { recursive: true, force: true })
  })

  it('resolves the cascaded sections alone when the directory has no entry for the build', async () => {
    await write('.', { maven: { mavenOpts: '-Proot', javaHome: '/jdk' } })
    await write('svc', { maven: { mavenOpts: '-Psvc' } })

    const resolved = createBuildRootSettingsResolver()('maven', maven('svc'))

    expect(resolved.entryKey).toBeUndefined()
    expect(resolved.sockJson.defaults?.manifest?.maven).toEqual({
      javaHome: '/jdk',
      mavenOpts: '-Psvc',
    })
  })

  it("applies a directory's entry to the build of that file only, after every section", async () => {
    await write('.', { maven: { javaHome: '/jdk-17' } })
    await write(
      'svc',
      {
        maven: { mavenOpts: '-B' },
        builds: { 'svc-alt.pom.xml': { mavenOpts: '-Palt' } },
      },
      ['pom.xml', 'svc-alt.pom.xml'],
    )
    const resolve = createBuildRootSettingsResolver()

    expect(
      resolve('maven', maven('svc')).sockJson.defaults?.manifest?.maven,
    ).toEqual({ javaHome: '/jdk-17', mavenOpts: '-B' })
    const alt = resolve('maven', maven('svc', 'svc-alt.pom.xml'))
    expect(alt.entryKey).toBe('svc-alt.pom.xml')
    expect(alt.sockJson.defaults?.manifest?.maven).toEqual({
      javaHome: '/jdk-17',
      mavenOpts: '-Palt',
    })
  })

  it('names a Gradle or sbt build by any build file of its directory', async () => {
    await write(
      'lib',
      { builds: { 'settings.gradle.kts': { disabled: true } } },
      ['settings.gradle.kts'],
    )

    const resolved = createBuildRootSettingsResolver()('gradle', {
      dir: path.join(scanRoot, 'lib'),
    })

    expect(resolved.disabledBy).toEqual({
      dir: path.join(scanRoot, 'lib'),
      key: 'settings.gradle.kts',
    })
  })

  it('applies no entry that names a missing build file of a Gradle build', async () => {
    await write(
      'lib',
      {
        gradle: { javaHome: '/jdk-21' },
        builds: { 'build.gradle': { disabled: true, javaHome: '/jdk-8' } },
      },
      ['build.gradle.kts'],
    )

    const resolved = createBuildRootSettingsResolver()('gradle', {
      dir: path.join(scanRoot, 'lib'),
    })

    expect(resolved.disabledBy).toBeUndefined()
    expect(resolved.entryKey).toBeUndefined()
    expect(resolved.sockJson.defaults?.manifest?.gradle).toEqual({
      javaHome: '/jdk-21',
    })
  })

  it('rejects two entries that name the same Gradle build', async () => {
    await write(
      'lib',
      {
        builds: {
          'build.gradle': { disabled: true },
          'settings.gradle': { disabled: false },
        },
      },
      ['build.gradle', 'settings.gradle'],
    )

    expect(() =>
      createBuildRootSettingsResolver()('gradle', {
        dir: path.join(scanRoot, 'lib'),
      }),
    ).toThrow(/configure the same gradle build/)
  })

  it('ignores the entries of other directories, above or below', async () => {
    await write('.', { builds: { 'pom.xml': { disabled: true } } }, ['pom.xml'])
    await write('svc', {}, ['pom.xml'])

    expect(
      createBuildRootSettingsResolver()('maven', maven('svc')).disabledBy,
    ).toBeUndefined()
  })

  it('tells a skip of the build itself from a skip of its directory', async () => {
    await write('legacy', { maven: { disabled: true } }, ['pom.xml'])
    await write('legacy/tool', {}, ['pom.xml'])
    await write('app', { builds: { 'pom.xml': { disabled: true } } }, [
      'pom.xml',
    ])
    const resolve = createBuildRootSettingsResolver()

    const tool = resolve('maven', maven('legacy/tool')).disabledBy!
    expect(tool).toEqual({ dir: path.join(scanRoot, 'legacy') })
    expect(describeDisabledBy('maven', tool)).toBe(
      `${displayPath(path.join(scanRoot, 'legacy/socket.json'))} sets defaults.manifest.maven.disabled`,
    )
    const app = resolve('maven', maven('app')).disabledBy!
    expect(describeDisabledBy('maven', app)).toBe(
      `${displayPath(path.join(scanRoot, 'app/socket.json'))} sets defaults.manifest.builds["pom.xml"].disabled`,
    )
  })

  it('turns one build back on under a skipped directory through its entry', async () => {
    await write(
      'legacy',
      {
        maven: { disabled: true },
        builds: { 'legacy-keep.pom.xml': { disabled: false } },
      },
      ['pom.xml', 'legacy-keep.pom.xml'],
    )
    const resolve = createBuildRootSettingsResolver()

    expect(resolve('maven', maven('legacy')).disabledBy).toBeDefined()
    expect(
      resolve('maven', maven('legacy', 'legacy-keep.pom.xml')).disabledBy,
    ).toBeUndefined()
  })

  it.for([
    ['svc/pom.xml', 'must be keyed by the name of a build file'],
    ['README.md', 'must be keyed by the name of a build file'],
    ['..', 'must be keyed by the name of a build file'],
  ] as const)('rejects the key %j', async ({ 0: key, 1: reason }) => {
    await write('.', { builds: { [key]: { disabled: true } } })
    const root = maven('.')

    expect(() => createBuildRootSettingsResolver()('maven', root)).toThrow(
      InputError,
    )
    expect(() => createBuildRootSettingsResolver()('maven', root)).toThrow(
      expect.objectContaining({ message: expect.stringContaining(reason) }),
    )
  })

  it.for([
    [{ 'pom.xml': true }, 'must be an object'],
    [{ 'pom.xml': { disabled: 'yes' } }, 'must be true or false'],
  ] as const)('rejects the entries %j', async ({ 0: builds, 1: reason }) => {
    await write('.', { builds }, ['pom.xml'])

    expect(() =>
      createBuildRootSettingsResolver()('maven', maven('.')),
    ).toThrow(
      expect.objectContaining({ message: expect.stringContaining(reason) }),
    )
  })

  it('warns once about an entry for a file that is not there', async () => {
    await write('.', { builds: { 'old-gone.pom.xml': { disabled: true } } })
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    try {
      const resolve = createBuildRootSettingsResolver()
      resolve('maven', maven('.'))
      resolve('maven', maven('.', 'app-other.pom.xml'))

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
        'defaults.manifest.builds["old-gone.pom.xml"]',
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('keeps a directory skip a directory skip when a build there is also skipped by name', async () => {
    await write(
      'legacy',
      { maven: { disabled: true }, builds: { 'pom.xml': { disabled: true } } },
      ['pom.xml'],
    )

    expect(
      createBuildRootSettingsResolver()('maven', maven('legacy')).disabledBy,
    ).toEqual({ dir: path.join(scanRoot, 'legacy') })
  })
})
