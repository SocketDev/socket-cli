import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockWorker } = vi.hoisted(() => ({ mockWorker: vi.fn() }))

function mockCreateRequire(): (specifier: string) => unknown {
  return (specifier: string) =>
    specifier === 'node:sea' ? { isSea: () => true } : undefined
}

vi.mock('node:module', async importOriginal => {
  const actual = await importOriginal<typeof import('node:module')>()
  return {
    ...actual,
    createRequire: mockCreateRequire,
  }
})
vi.mock('node:worker_threads', () => ({ Worker: mockWorker }))

import {
  SEA_CAPABILITIES_PATH,
  SEA_RESOURCES_DIRECTORY,
} from '../../../src/sea/paths/archive.mts'
import { seaNativeToolPaths } from '../../../src/sea/paths/native-tools.mts'
import {
  assertEmbeddedToolAvailable,
  cleanupBundledTool,
  getBundledTool,
  runEmbeddedJsTool,
} from '../../../src/sea/runtime.mts'

type SeaGlobal = typeof globalThis & { __socketSeaVfsRoot?: string }

describe('embedded SEA tool capabilities', () => {
  let root: string | undefined
  const seaGlobal = globalThis as SeaGlobal
  const oldRoot = seaGlobal.__socketSeaVfsRoot

  afterEach(async () => {
    if (root) {
      await fs.rm(root, { recursive: true, force: true })
    }
    root = undefined
    if (oldRoot === undefined) {
      delete seaGlobal.__socketSeaVfsRoot
    } else {
      seaGlobal.__socketSeaVfsRoot = oldRoot
    }
    mockWorker.mockClear()
  })

  async function setup(manifest?: unknown): Promise<void> {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-sea-capabilities-'))
    seaGlobal.__socketSeaVfsRoot = root
    if (manifest !== undefined) {
      await fs.mkdir(path.join(root, SEA_RESOURCES_DIRECTORY), {
        recursive: true,
      })
      await fs.writeFile(
        path.join(root, SEA_CAPABILITIES_PATH),
        JSON.stringify(manifest),
      )
    }
  }

  it('fails closed with the recorded reason even when the entrypoint exists', async () => {
    await setup({
      available: [],
      unavailable: [
        {
          id: 'manifest-cdxgen-npm-lock-v3',
          reason: 'provenance is unverified',
        },
      ],
    })
    const entrypoint = path.join(root!, 'tools/cdxgen/sea-worker.js')
    await fs.mkdir(path.dirname(entrypoint), { recursive: true })
    await fs.writeFile(entrypoint, '')

    expect(() => assertEmbeddedToolAvailable('cdxgen')).toThrow(
      /provenance is unverified/,
    )
    await expect(runEmbeddedJsTool('cdxgen', [])).rejects.toThrow(
      /provenance is unverified/,
    )
    expect(mockWorker).not.toHaveBeenCalled()
  })

  it.each([undefined, { available: ['synp'] }, { available: 'cdxgen' }])(
    'rejects missing or malformed capabilities: %j',
    async manifest => {
      await setup(manifest)
      expect(() => assertEmbeddedToolAvailable('cdxgen')).toThrow(
        /capabilities are missing or invalid/,
      )
    },
  )

  it('allows the matching stable capability identifier', async () => {
    await setup({
      available: ['manifest-cdxgen-yarn-classic'],
      unavailable: [],
    })
    expect(() => assertEmbeddedToolAvailable('cdxgen')).not.toThrow()
  })

  it.each(['node', 'uv', 'socket-patch'] as const)(
    'verifies and cleans up the extracted %s executable',
    async id => {
      await setup()
      const paths = seaNativeToolPaths(id, process.platform)
      const binary = path.join(root!, paths.binary)
      const contents = 'fixture executable'
      await fs.mkdir(path.dirname(binary), { recursive: true })
      await fs.writeFile(binary, contents)
      await fs.writeFile(
        path.join(root!, paths.digest),
        `${createHash('sha256').update(contents).digest('hex')}\n`,
      )
      const executable = await getBundledTool(id)
      try {
        expect(path.basename(executable)).toBe(
          process.platform === 'win32' ? `${id}.exe` : id,
        )
        expect(await fs.readFile(executable, 'utf8')).toBe(contents)
      } finally {
        await cleanupBundledTool(executable)
      }
      await expect(fs.stat(executable)).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await fs.writeFile(binary, 'changed executable')
      await expect(getBundledTool(id)).rejects.toThrow(/SHA-256 verification/)
    },
  )
})
