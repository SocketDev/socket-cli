import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'
import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import {
  createBuildRootSettingsResolver,
  describeDisabledBy,
  displayPath,
  socketJsonReachability,
} from './build-root-config.mts'
import { InputError } from '../../utils/errors.mts'

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
  const dotnet = (dir: string) => ({
    dir: path.join(scanRoot, dir),
    entryFile: 'App.sln',
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

  describe('reachability', () => {
    it('cascades each field on its own, the build entry last, and drops cleared ones', async () => {
      await write('.', {
        maven: { reachability: { build: 'compile', javaHome: '$JDK17' } },
      })
      await write(
        'svc',
        {
          maven: { reachability: { javaHome: null } },
          builds: { 'pom.xml': { reachability: { javaHome: '$JDK21' } } },
        },
        ['pom.xml', 'svc-alt.pom.xml'],
      )
      const resolve = createBuildRootSettingsResolver()

      expect(resolve('maven', maven('svc')).reachability()).toEqual({
        build: 'compile',
        javaHome: '$JDK21',
      })
      expect(
        resolve('maven', maven('svc', 'svc-alt.pom.xml')).reachability(),
      ).toEqual({ build: 'compile' })
    })

    it.for([
      {
        name: 'no socket.json sets any',
        settings: {},
        files: undefined,
      },
      {
        name: 'a socket.json clears every field with null',
        settings: { maven: { reachability: { build: null } } },
        files: undefined,
      },
      {
        name: "the build's own entry clears what its directory sets",
        settings: {
          maven: { reachability: { build: 'compile' } },
          builds: { 'pom.xml': { reachability: { build: null } } },
        },
        files: ['pom.xml'],
      },
    ])('is undefined when $name', async ({ files, settings }) => {
      await write('.', settings, files)

      expect(
        createBuildRootSettingsResolver()('maven', maven('.')).reachability(),
      ).toBeUndefined()
    })

    it.for([
      { runtimeVersion: '8.0', valid: true },
      { runtimeVersion: '10.0.1', valid: true },
      { runtimeVersion: '9.0.0-rc.2.24473.5', valid: true },
      { runtimeVersion: '8', valid: false },
      { runtimeVersion: 'net8.0', valid: false },
      { runtimeVersion: '08.0', valid: false },
      { runtimeVersion: '8.0.1.2', valid: false },
      { runtimeVersion: '8.0-rc.1', valid: false },
      { runtimeVersion: '8.0.1+build', valid: false },
    ])(
      'takes the .NET runtime version $runtimeVersion: $valid',
      async ({ runtimeVersion, valid }) => {
        await write('.', { dotnet: { reachability: { runtimeVersion } } })
        const resolved = createBuildRootSettingsResolver()(
          'dotnet',
          dotnet('.'),
        )

        if (valid) {
          expect(resolved.reachability()).toEqual({ runtimeVersion })
        } else {
          expect(() => resolved.reachability()).toThrow(
            /reachability\.runtimeVersion` in .*socket\.json is .*; set it to a \.NET runtime version/,
          )
        }
      },
    )

    it.for([
      {
        name: 'a field of another tool',
        tool: 'maven',
        reachability: { runtimeVersion: '8.0' },
        reason: 'is not a reachability setting of maven builds',
      },
      {
        name: 'a JVM field on dotnet',
        tool: 'dotnet',
        reachability: { javaHome: '/jdk' },
        reason: 'is not a reachability setting of dotnet builds',
      },
      {
        name: 'a misspelt field',
        tool: 'gradle',
        reachability: { java_home: '/jdk' },
        reason: 'is not a reachability setting of gradle builds',
      },
      {
        name: 'an unknown build',
        tool: 'sbt',
        reachability: { build: 'test' },
        reason: 'set it to "compile" or "none"',
      },
      {
        name: 'a JDK that is no string',
        tool: 'gradle',
        reachability: { javaHome: 17 },
        reason: 'set it to a JDK path',
      },
      {
        name: 'an empty JDK',
        tool: 'maven',
        reachability: { javaHome: '' },
        reason: 'set it to a JDK path',
      },
      {
        name: 'a section that is no object',
        tool: 'maven',
        reachability: 'compile',
        reason: 'set it to an object',
      },
    ] as const)(
      'rejects $name, naming the socket.json that sets it',
      async ({ reachability, reason, tool }) => {
        await write('.', { [tool]: { reachability: {} } })
        await write('nested', { [tool]: { reachability } })
        const root = { dir: path.join(scanRoot, 'nested') }

        expect(() =>
          createBuildRootSettingsResolver()(tool, root).reachability(),
        ).toThrow(
          expect.objectContaining({
            constructor: InputError,
            message: expect.stringMatching(
              new RegExp(
                `^\`defaults\\.manifest\\.${tool}\\.reachability.*\\bnested.socket\\.json.*${escapeRegExp(reason)}`,
              ),
            ),
          }),
        )
      },
    )

    it("rejects an invalid setting in a build's own entry, naming the entry", async () => {
      await write(
        '.',
        { builds: { 'pom.xml': { reachability: { runtimeVersion: '8.0' } } } },
        ['pom.xml'],
      )

      expect(() =>
        createBuildRootSettingsResolver()('maven', maven('.')).reachability(),
      ).toThrow(
        /^`defaults\.manifest\.builds\["pom\.xml"\]\.reachability\.runtimeVersion` in /,
      )
    })

    it("resolves a build's other settings whatever its reachability holds", async () => {
      await write('.', {
        maven: { mavenOpts: '-B', reachability: { build: 'always' } },
      })

      expect(
        createBuildRootSettingsResolver()('maven', maven('.')).sockJson.defaults
          ?.manifest?.maven?.mavenOpts,
      ).toBe('-B')
    })
  })
})

describe('socketJsonReachability', () => {
  it("checks one socket.json's section for the tool alone", () => {
    const sockJson = {
      defaults: {
        manifest: {
          dotnet: { reachability: { runtimeVersion: 'latest' } },
          gradle: { reachability: { build: 'compile' } },
        },
      },
    } as any

    expect(socketJsonReachability('gradle', { dir: '/r', sockJson })).toEqual({
      build: 'compile',
    })
    expect(() =>
      socketJsonReachability('dotnet', { dir: '/r', sockJson }),
    ).toThrow(InputError)
  })
})
