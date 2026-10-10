import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CMD_NAME, cmdPatch } from '../../../../src/command/patch/cmd-patch.mts'
import {
  readPatchManifest,
  writePatchManifest,
} from '../../../../src/core/patch/manifest.mts'

import type { PatchManifest } from '../../../../src/core/patch/manifest.mts'
import type * as DryRunOutputModule from '../../../../src/util/dry-run/output.mjs'
import type * as WithSubcommandsModule from '../../../../src/util/cli/with-subcommands.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const mockShowHelp = vi.hoisted(() =>
  vi.fn((code?: number | undefined): never => {
    throw new Error(`showHelp exit ${code}`)
  }),
)

const mockMeowOrExit = vi.hoisted(() => vi.fn())
const mockOutputDryRunExecute = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({ log: vi.fn(), error: vi.fn() }))
const mockSpawnSocketPatch = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    spawnPromise: Promise.resolve({ code: 0, signal: undefined }),
  }),
)

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock(
  import('../../../../src/util/cli/with-subcommands.mts'),
  async importOriginal => {
    const actual = await importOriginal<typeof WithSubcommandsModule>()
    return { ...actual, meowOrExit: mockMeowOrExit }
  },
)

vi.mock(import('../../../../src/core/patch/spawn.mts'), () => ({
  spawnSocketPatch: mockSpawnSocketPatch,
}))

vi.mock(
  import('../../../../src/util/dry-run/output.mjs'),
  async importOriginal => {
    const actual = await importOriginal<typeof DryRunOutputModule>()
    return { ...actual, outputDryRunExecute: mockOutputDryRunExecute }
  },
)

const importMeta = { url: 'file:///test/cmd-patch.mts' }
const context = { parentName: 'socket' }
const patchPurl = 'pkg:npm/on-headers@1.0.2'

const patchManifest: PatchManifest = {
  patches: {
    [patchPurl]: {
      uuid: '00000000-0000-0000-0000-000000000000',
      exportedAt: '2025-09-10T20:10:19.407Z',
      files: {},
      vulnerabilities: {},
      description: 'Patch for on-headers',
      license: 'MIT',
      tier: 'free',
    },
  },
}

async function withProjectDirectory(
  run: (projectRoot: string) => Promise<void>,
): Promise<void> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
  try {
    await writePatchManifest(projectRoot, patchManifest)
    await run(projectRoot)
  } finally {
    await safeDelete(projectRoot)
  }
}

describe('cmd-patch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockMeowOrExit.mockReturnValue({ flags: {}, showHelp: mockShowHelp })
    process.exitCode = undefined
  })

  it('exports the patch command metadata', () => {
    expect(CMD_NAME).toBe('patch')
    expect(cmdPatch.description).toBe('Manage CVE patches for dependencies')
    expect(cmdPatch.hidden).toBe(false)
  })

  it('keeps the root help path when no subcommand is given', async () => {
    await expect(cmdPatch.run([], importMeta, context)).rejects.toThrow(
      'showHelp exit 2',
    )
    expect(mockMeowOrExit).toHaveBeenCalled()
    expect(mockShowHelp).toHaveBeenCalledWith(2)
  })

  it('lists manifest entries in-process', async () => {
    await withProjectDirectory(async projectRoot => {
      await cmdPatch.run(['list', '--cwd', projectRoot], importMeta, context)

      expect(process.exitCode).toBe(0)
      expect(mockSpawnSocketPatch).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining(patchPurl),
      )
    })
  })

  it('sanitizes invalid manifest identifiers in text errors', async () => {
    await withProjectDirectory(async projectRoot => {
      const purl = 'pkg:npm/fable-pixel\u001b[31m\u0085@1.0.0'
      await writeFile(
        path.join(projectRoot, '.socket', 'manifest.json'),
        JSON.stringify({ patches: { [purl]: {} } }),
      )

      await cmdPatch.run(['list', '--cwd', projectRoot], importMeta, context)

      const output = String(mockLogger.error.mock.calls[0]?.[0])
      expect(process.exitCode).toBe(1)
      expect(output).toContain('fable-pixel[31m@1.0.0')
      expect(output).not.toMatch(/[\u001b\u007f-\u009f]/u)
    })
  })

  it('removes manifest records in-process when rollback is skipped', async () => {
    await withProjectDirectory(async projectRoot => {
      await cmdPatch.run(
        ['remove', patchPurl, '--skip-rollback', '--cwd', projectRoot],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(0)
      expect(mockSpawnSocketPatch).not.toHaveBeenCalled()
      expect(await readPatchManifest(projectRoot)).toEqual({ patches: {} })
    })
  })

  it('emits JSON for a successful manifest removal', async () => {
    await withProjectDirectory(async projectRoot => {
      await cmdPatch.run(
        [
          'remove',
          patchPurl,
          '--skip-rollback',
          '--cwd',
          projectRoot,
          '--json',
        ],
        importMeta,
        context,
      )

      const output = mockLogger.log.mock.calls[0]?.[0]
      expect(JSON.parse(String(output))).toEqual({
        status: 'success',
        dryRun: false,
        removed: [patchPurl],
      })
    })
  })

  it('previews manifest removal without writing in dry-run mode', async () => {
    await withProjectDirectory(async projectRoot => {
      await cmdPatch.run(
        [
          'remove',
          patchPurl,
          '--skip-rollback',
          '--cwd',
          projectRoot,
          '--dry-run',
        ],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(0)
      expect(await readPatchManifest(projectRoot)).toEqual(patchManifest)
    })
  })

  it('preserves unported get and default remove behavior', async () => {
    await cmdPatch.run(['get', 'lodash'], importMeta, context)
    await cmdPatch.run(['remove', patchPurl], importMeta, context)

    expect(mockSpawnSocketPatch).toHaveBeenCalledTimes(2)
    expect(mockSpawnSocketPatch).toHaveBeenNthCalledWith(
      1,
      ['get', 'lodash'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(mockSpawnSocketPatch).toHaveBeenNthCalledWith(
      2,
      ['remove', patchPurl],
      expect.objectContaining({ stdio: 'inherit' }),
    )
  })

  it('keeps dry-run output for commands that still use socket-patch', async () => {
    await cmdPatch.run(['apply', '--dry-run'], importMeta, context)

    expect(mockOutputDryRunExecute).toHaveBeenCalledWith(
      'socket-patch',
      ['apply'],
      'socket-patch',
    )
    expect(mockSpawnSocketPatch).not.toHaveBeenCalled()
  })
})
