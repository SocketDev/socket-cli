import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readSocketJsonCascade } from './socket-json.mts'

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

describe('readSocketJsonCascade', () => {
  let root = ''
  let rootSockJson: SocketJson

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'socket-json-cascade-'))
    rootSockJson = {
      version: 1,
      defaults: {
        manifest: {
          maven: { bin: 'mvn', excludeConfigs: 'root-exclude' },
        },
      },
    } as SocketJson
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('returns rootSockJson unchanged when dir is the boundary itself', () => {
    expect(readSocketJsonCascade(root, root, rootSockJson)).toBe(rootSockJson)
  })

  it('returns rootSockJson unchanged when nothing is found between dir and the boundary', async () => {
    const buildRoot = path.join(root, 'workspace', 'project')
    await fs.mkdir(buildRoot, { recursive: true })

    const result = readSocketJsonCascade(buildRoot, root, rootSockJson)
    expect(result).toBe(rootSockJson)
  })

  it("merges the build root's own socket.json over the root config instead of replacing it", async () => {
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } },
    })

    const result = readSocketJsonCascade(buildRoot, root, rootSockJson)
    expect(mavenConfig(result)).toEqual({
      bin: 'mvn',
      excludeConfigs: 'root-exclude',
      javaHome: '/opt/jdk-11',
    })
  })

  it('does not touch an ecosystem the override never mentions', async () => {
    rootSockJson = {
      version: 1,
      defaults: {
        manifest: {
          gradle: { bin: './gradlew' },
          maven: { bin: 'mvn' },
        },
      },
    } as SocketJson
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, {
      version: 1,
      defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } },
    })

    const result = readSocketJsonCascade(buildRoot, root, rootSockJson)
    expect(result.defaults?.manifest?.gradle).toEqual({ bin: './gradlew' })
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

    const result = readSocketJsonCascade(buildRoot, root, rootSockJson)
    expect(mavenConfig(result)).toEqual({
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

  it('does not walk past the boundary even if an ancestor above it has one', async () => {
    await writeSocketJson(tmpdir(), {
      version: 1,
      defaults: { manifest: { maven: { javaHome: '/outside-scope' } } },
    })
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })

    try {
      const result = readSocketJsonCascade(buildRoot, root, rootSockJson)
      expect(result).toBe(rootSockJson)
    } finally {
      await fs.rm(path.join(tmpdir(), 'socket.json'), { force: true })
    }
  })
})
