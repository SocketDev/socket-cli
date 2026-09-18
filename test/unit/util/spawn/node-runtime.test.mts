import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import os from 'node:os'
import path from 'node:path'
import sea from 'node:sea'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveNodeRuntime } from '../../../../src/util/spawn/node-runtime.mts'
import { spawnNode } from '../../../../src/util/spawn/spawn-node.mts'
import { clearSystemToolCache } from '../../../../src/util/spawn/system-tool.mts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  clearSystemToolCache()
  for (const directory of temporaryDirectories.splice(0)) {
    await safeDelete(directory)
  }
})

describe('Node runtime resolution', () => {
  it('uses the current interpreter outside SEA', async () => {
    const runtime = await resolveNodeRuntime({ env: { EXAMPLE: 'value' } })
    expect(runtime.executable).toBe(process.execPath)
    expect(runtime.environment).toEqual({ EXAMPLE: 'value' })
  })

  it('runs JavaScript in a trusted Node child from SEA', async () => {
    vi.spyOn(sea, 'isSea').mockReturnValue(true)
    const result = await spawnNode(
      ['-e', "process.stdout.write(String(require('node:sea').isSea()))"],
      { stdio: 'pipe' },
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('false')
  })

  it('rejects a checkout-provided Node executable', async () => {
    vi.spyOn(sea, 'isSea').mockReturnValue(true)
    const root = mkdtempSync(path.join(os.tmpdir(), 'socket-node-runtime-'))
    temporaryDirectories.push(root)
    const binary = path.join(
      root,
      process.platform === 'win32' ? 'node.exe' : 'node',
    )
    mkdirSync(path.join(root, '.git'))
    writeFileSync(binary, 'example hostile executable', { mode: 0o755 })
    await expect(
      resolveNodeRuntime({ cwd: root, env: { PATH: root } }),
    ).rejects.toThrow()
  })
})
