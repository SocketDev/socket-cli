import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { relocateDarwinInitializerOffsets } from '../../../../../scripts/repo/build/sea/initializer-offsets.mts'
import { repairDarwinInitializerOffsets } from '../../../../../scripts/repo/build/sea/initializer-repair.mts'

const state = vi.hoisted(() => ({
  bytes: Buffer.from('injected'),
  calls: [] as string[][],
  failAt: -1,
  codesignCalls: 0,
  repairFailure: false,
  readFile: vi.fn(),
  writeFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock(import('node:fs/promises'), () => ({
  readFile: state.readFile,
  writeFile: state.writeFile,
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: state.spawn,
}))

vi.mock(import('../../../../../scripts/repo/build/sea/initializer-offsets.mts'), () => ({
  relocateDarwinInitializerOffsets: vi.fn((_runtime: Buffer, injected: Buffer) => {
    state.calls.push(['relocate'])
    if (state.repairFailure) {
      throw new Error('initializer repair failed')
    }
    return injected.toString() === 'changed'
      ? Buffer.from('relocated')
      : injected
  }),
}))

describe('repairDarwinInitializerOffsets', () => {
  beforeEach(() => {
    state.bytes = Buffer.from('injected')
    state.calls = []
    state.failAt = -1
    state.codesignCalls = 0
    state.repairFailure = false
    vi.clearAllMocks()
    state.readFile.mockReset().mockImplementation(async () => {
      state.calls.push(['read'])
      return state.bytes
    })
    state.writeFile.mockReset().mockImplementation(async (_path: unknown, bytes: Buffer) => {
      state.calls.push(['write'])
      state.bytes = Buffer.from(bytes)
    })
    state.spawn.mockReset().mockImplementation(async (_command: string, args: string[]) => {
      const callIndex = state.codesignCalls
      state.codesignCalls += 1
      state.calls.push(args)
      return { code: callIndex === state.failAt ? 1 : 0 }
    })
  })

  it('removes, relocates, signs, and verifies in order on Darwin', async () => {
    state.bytes = Buffer.from('changed')
    await repairDarwinInitializerOffsets(Buffer.from('runtime'), '/tmp/socket', { platform: 'darwin' })
    expect(state.calls).toEqual([
      ['--remove-signature', '/tmp/socket'],
      ['read'],
      ['relocate'],
      ['write'],
      ['--force', '--sign', '-', '/tmp/socket'],
      ['--verify', '--strict', '/tmp/socket'],
    ])
    expect(state.bytes.toString()).toBe('relocated')
    expect(readFile).toHaveBeenCalledWith('/tmp/socket')
    expect(writeFile).toHaveBeenCalledWith('/tmp/socket', Buffer.from('relocated'))
    expect(relocateDarwinInitializerOffsets).toHaveBeenCalledWith(Buffer.from('runtime'), Buffer.from('changed'))
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('restores and verifies the signature when relocation is unchanged', async () => {
    await repairDarwinInitializerOffsets(Buffer.from('runtime'), '/tmp/socket', { platform: 'darwin' })
    expect(state.calls).toEqual([
      ['--remove-signature', '/tmp/socket'],
      ['read'],
      ['relocate'],
      ['--force', '--sign', '-', '/tmp/socket'],
      ['--verify', '--strict', '/tmp/socket'],
    ])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it.each([0, 1, 2])('stops when codesign step %i fails', async failAt => {
    state.failAt = failAt
    await expect(
      repairDarwinInitializerOffsets(Buffer.from('runtime'), '/tmp/socket', { platform: 'darwin' }),
    ).rejects.toThrow('Could not')
    expect(state.codesignCalls).toBe(failAt + 1)
  })

  it('does not sign or verify after offset repair fails', async () => {
    state.repairFailure = true
    await expect(
      repairDarwinInitializerOffsets(Buffer.from('runtime'), '/tmp/socket', { platform: 'darwin' }),
    ).rejects.toThrow('initializer repair failed')
    expect(state.calls).toEqual([
      ['--remove-signature', '/tmp/socket'],
      ['read'],
      ['relocate'],
    ])
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('repairs offsets without Apple commands on other hosts', async () => {
    state.bytes = Buffer.from('changed')
    await repairDarwinInitializerOffsets(Buffer.from('runtime'), '/tmp/socket', { platform: 'linux' })
    expect(state.calls).toEqual([['read'], ['relocate'], ['write']])
    expect(state.bytes.toString()).toBe('relocated')
    expect(spawn).not.toHaveBeenCalled()
  })
})
