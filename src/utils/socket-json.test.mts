import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  mergeSocketJsonChain,
  readOrDefaultSocketJson,
  readSocketJsonChain,
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

  it("cascades a build tool's reachability field by field", async () => {
    await writeSocketJson(root, {
      version: 1,
      defaults: {
        manifest: {
          dotnet: { reachability: { build: 'compile', runtimeVersion: '8.0' } },
          maven: { reachability: { build: 'compile', javaHome: '/jdk-17' } },
        },
      },
    })
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: {
        manifest: {
          dotnet: { reachability: { runtimeVersion: null } },
          maven: { reachability: { build: 'none' } },
        },
      },
    })

    const manifest = readSocketJsonCascade(buildRoot).defaults?.manifest
    expect(manifest?.maven?.reachability).toEqual({
      build: 'none',
      javaHome: '/jdk-17',
    })
    expect(manifest?.dotnet?.reachability).toEqual({
      build: 'compile',
      runtimeVersion: null,
    })
  })

  it('reads a socket.json whatever its reachability settings hold', async () => {
    await writeSocketJson(root, {
      version: 1,
      defaults: {
        manifest: {
          dotnet: { reachability: { runtimeVersion: 'net8.0' } },
          maven: { bin: 'mvn', reachability: 'compile' },
        },
      },
    })

    expect(mavenConfig(readOrDefaultSocketJson(root))?.bin).toBe('mvn')
    expect(mavenConfig(readSocketJsonCascade(root))?.reachability).toBe(
      'compile',
    )
  })
})
