import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeSocketJsonChain, readSocketJsonChain } from './socket-json.mts'

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
  })
})
