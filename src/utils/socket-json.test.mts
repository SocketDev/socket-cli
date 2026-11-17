import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InputError } from './errors.mts'
import {
  mergeSocketJsonChain,
  readOrDefaultSocketJson,
  readSocketJsonChain,
  readSocketJsonSync,
} from './socket-json.mts'

import type { SocketJson } from './socket-json.mts'

async function writeSocketJson(dir: string, data: unknown): Promise<void> {
  await fs.writeFile(
    path.join(dir, 'socket.json'),
    JSON.stringify(data),
    'utf8',
  )
}

function mavenConfig(sockJson: SocketJson) {
  return sockJson.defaults?.manifest?.maven
}

function readSocketJsonCascade(dir: string): SocketJson {
  return mergeSocketJsonChain(readSocketJsonChain(dir))
}

describe('readSocketJsonChain and mergeSocketJsonChain', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'socket-json-cascade-'))
    await writeSocketJson(root, {
      version: 1,
      defaults: {
        manifest: {
          maven: { bin: 'mvn', excludeConfigs: 'root-exclude' },
        },
      },
    })
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('reads the socket.json of every directory above, however far up', async () => {
    const buildRoot = path.join(root, 'workspace', 'project')
    await fs.mkdir(buildRoot, { recursive: true })

    expect(mavenConfig(readSocketJsonCascade(buildRoot))).toEqual({
      bin: 'mvn',
      excludeConfigs: 'root-exclude',
    })
  })

  it("merges the build root's own socket.json over the ones above instead of replacing them", async () => {
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } },
    })

    expect(mavenConfig(readSocketJsonCascade(buildRoot))).toEqual({
      bin: 'mvn',
      excludeConfigs: 'root-exclude',
      javaHome: '/opt/jdk-11',
    })
  })

  it('does not touch an ecosystem the override never mentions', async () => {
    await writeSocketJson(root, {
      version: 1,
      defaults: {
        manifest: {
          gradle: { bin: './gradlew' },
          maven: { bin: 'mvn' },
        },
      },
    })
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } },
    })

    expect(readSocketJsonCascade(buildRoot).defaults?.manifest?.gradle).toEqual(
      { bin: './gradlew' },
    )
  })

  it('cascades multiple levels, nearest-to-dir winning per field', async () => {
    const workspace = path.join(root, 'workspace')
    const buildRoot = path.join(workspace, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(workspace, {
      version: 1,
      defaults: {
        manifest: {
          maven: {
            excludeConfigs: 'workspace-exclude',
            includeConfigs: 'workspace-include',
          },
        },
      },
    })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } },
    })

    expect(mavenConfig(readSocketJsonCascade(buildRoot))).toEqual({
      // From root, untouched by either override.
      bin: 'mvn',
      // Workspace overrides root; project doesn't mention it.
      excludeConfigs: 'workspace-exclude',
      // From workspace only.
      includeConfigs: 'workspace-include',
      // From the nearest file only.
      javaHome: '/opt/jdk-11',
    })
  })

  it('treats an explicit null as clearing an inherited value, not restating it', async () => {
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { excludeConfigs: null } } },
    })

    expect(mavenConfig(readSocketJsonCascade(buildRoot))).toEqual({
      bin: 'mvn',
      excludeConfigs: null,
    })
  })

  describe('reachability', () => {
    let buildRoot = ''

    beforeEach(async () => {
      await writeSocketJson(root, {
        version: 1,
        defaults: {
          manifest: {
            maven: { reachability: { javaHome: '$JAVA17_HOME' } },
          },
        },
      })
      buildRoot = path.join(root, 'project')
      await fs.mkdir(buildRoot, { recursive: true })
    })

    it('inherits the reachability javaHome when the override only sets other fields', async () => {
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(mavenConfig(result)).toEqual({
        javaHome: '/opt/jdk-11',
        reachability: { javaHome: '$JAVA17_HOME' },
      })
    })

    it('lets the nearest socket.json override the reachability javaHome', async () => {
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: {
          manifest: { maven: { reachability: { javaHome: '/opt/jdk-21' } } },
        },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(mavenConfig(result)?.reachability).toEqual({
        javaHome: '/opt/jdk-21',
      })
    })

    it('treats an explicit null reachability javaHome as clearing the inherited one', async () => {
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: { manifest: { maven: { reachability: { javaHome: null } } } },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(mavenConfig(result)?.reachability).toEqual({ javaHome: null })
    })

    it('merges reachability field by field rather than replacing it whole', async () => {
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: { manifest: { maven: { reachability: { other: 'x' } } } },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(mavenConfig(result)?.reachability).toEqual({
        javaHome: '$JAVA17_HOME',
        other: 'x',
      })
    })

    it('cascades gradle and sbt reachability the same way', async () => {
      await writeSocketJson(root, {
        version: 1,
        defaults: {
          manifest: {
            gradle: { reachability: { javaHome: '/opt/gradle-jdk' } },
            sbt: { reachability: { javaHome: '/opt/sbt-jdk' } },
          },
        },
      })
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: {
          manifest: {
            gradle: { reachability: { javaHome: null } },
            sbt: { bin: 'sbt' },
          },
        },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(result.defaults?.manifest?.gradle?.reachability).toEqual({
        javaHome: null,
      })
      expect(result.defaults?.manifest?.sbt?.reachability).toEqual({
        javaHome: '/opt/sbt-jdk',
      })
    })

    it('cascades the reachability build field by field, for dotnet too', async () => {
      await writeSocketJson(root, {
        version: 1,
        defaults: {
          manifest: {
            dotnet: { reachability: { build: 'compile' } },
            maven: { reachability: { javaHome: '$JAVA17_HOME' } },
          },
        },
      })
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: {
          manifest: {
            dotnet: { bin: 'dotnet' },
            maven: { reachability: { build: 'compile' } },
          },
        },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(result.defaults?.manifest?.dotnet).toEqual({
        bin: 'dotnet',
        reachability: { build: 'compile' },
      })
      expect(mavenConfig(result)?.reachability).toEqual({
        build: 'compile',
        javaHome: '$JAVA17_HOME',
      })
    })

    it("lets a nested socket.json's none override an inherited compile", async () => {
      await writeSocketJson(root, {
        version: 1,
        defaults: {
          manifest: { gradle: { reachability: { build: 'compile' } } },
        },
      })
      await writeSocketJson(buildRoot, {
        version: 1,
        defaults: { manifest: { gradle: { reachability: { build: 'none' } } } },
      })

      const result = readSocketJsonCascade(buildRoot)
      expect(result.defaults?.manifest?.gradle?.reachability).toEqual({
        build: 'none',
      })
    })
  })
})

describe('reachability validation', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fs.realpath(
      await fs.mkdtemp(path.join(tmpdir(), 'socket-json-build-')),
    )
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it.for(['compile', 'none', undefined])(
    'accepts a build of %s',
    async build => {
      const sockJson = {
        version: 1,
        defaults: { manifest: { maven: { reachability: { build } } } },
      }
      await writeSocketJson(dir, sockJson)

      expect(readSocketJsonSync(dir)).toEqual({
        ok: true,
        data: JSON.parse(JSON.stringify(sockJson)),
      })
    },
  )

  it.for(['dotnet', 'gradle', 'maven', 'sbt'])(
    'rejects any other %s build, naming the key and the allowed values, even with defaultOnError',
    async tool => {
      await writeSocketJson(dir, {
        version: 1,
        defaults: {
          manifest: { [tool]: { reachability: { build: 'package' } } },
        },
      })

      expect(readSocketJsonSync(dir, true)).toEqual({
        ok: false,
        message: `Invalid socket.json at ${path.join(dir, 'socket.json')}`,
        cause: `\`defaults.manifest.${tool}.reachability.build\` is "package"; set it to "compile" or "none", or remove it`,
      })
    },
  )

  it('rejects a null build, as only an absent one means none', async () => {
    await writeSocketJson(dir, {
      version: 1,
      defaults: { manifest: { sbt: { reachability: { build: null } } } },
    })

    expect(readSocketJsonSync(dir).ok).toBe(false)
  })

  it.for([
    [
      'compile',
      '`defaults.manifest.maven.reachability` is "compile"; set it to an object, or remove it',
    ],
    [
      { javaHome: 17 },
      '`defaults.manifest.maven.reachability.javaHome` is 17; set it to a JDK path, or to null to clear an inherited one, or remove it',
    ],
  ] as const)(
    'rejects the reachability %j, naming the key',
    async ({ 0: reachability, 1: cause }) => {
      await writeSocketJson(dir, {
        version: 1,
        defaults: { manifest: { maven: { reachability } } },
      } as never)

      expect(readSocketJsonSync(dir)).toEqual({
        ok: false,
        message: `Invalid socket.json at ${path.join(dir, 'socket.json')}`,
        cause,
      })
    },
  )

  it.for(['/opt/jdk-17', null])(
    'rejects the .NET reachability javaHome %j, which .NET does not use',
    async javaHome => {
      await writeSocketJson(dir, {
        version: 1,
        defaults: { manifest: { dotnet: { reachability: { javaHome } } } },
      } as never)

      expect(readSocketJsonSync(dir)).toEqual({
        ok: false,
        message: `Invalid socket.json at ${path.join(dir, 'socket.json')}`,
        cause:
          '`defaults.manifest.dotnet.reachability.javaHome` does not apply to .NET; remove it',
      })
    },
  )

  it('accepts a null reachability javaHome, which clears an inherited one', async () => {
    await writeSocketJson(dir, {
      version: 1,
      defaults: { manifest: { gradle: { reachability: { javaHome: null } } } },
    })

    expect(readSocketJsonSync(dir).ok).toBe(true)
  })

  it('fails the command rather than falling back to the default socket.json', async () => {
    await writeSocketJson(dir, {
      version: 1,
      defaults: { manifest: { gradle: { reachability: { build: true } } } },
    })

    expect(() => readOrDefaultSocketJson(dir)).toThrow(InputError)
    expect(() => readOrDefaultSocketJson(dir)).toThrow(
      /defaults\.manifest\.gradle\.reachability\.build` is true; set it to "compile" or "none"/,
    )
  })

  it("fails the cascade on a nested socket.json's invalid build", async () => {
    const buildRoot = path.join(dir, 'project')
    await fs.mkdir(buildRoot)
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { reachability: { build: 'Compile' } } } },
    })

    expect(() => readSocketJsonCascade(buildRoot)).toThrow(InputError)
  })
})
