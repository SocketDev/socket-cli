import { closeSync, openSync } from 'node:fs'
import tty from 'node:tty'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  collectFirewallDescendants,
  hasFirewallControllingTerminal,
  readFirewallProcesses,
  signalFirewallDescendants,
  signalFirewallProcessGroup,
} from '../../../../src/core/firewall/child-processes.mts'

const spawnSync = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawnSync,
}))

vi.mock(import('node:fs'), async importOriginal => {
  const original = await importOriginal()
  return { ...original, openSync: vi.fn(), closeSync: vi.fn() }
})

afterEach(() => {
  vi.restoreAllMocks()
  spawnSync.mockReset()
  vi.mocked(openSync).mockReset()
  vi.mocked(closeSync).mockReset()
})

describe('firewall process identities', () => {
  it('accepts permission failure only when the group has no live processes', () => {
    const error = Object.assign(new Error('fixture permission'), {
      code: 'EPERM',
    })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error
    })
    for (const stdout of ['910001 Z\n910002 S\n', '910002 S\n']) {
      spawnSync.mockReturnValue({ status: 0, stdout })
      expect(() => signalFirewallProcessGroup(910_001, 'SIGKILL')).not.toThrow()
    }
    for (const result of [
      { status: 0, stdout: '910001 S\n' },
      { status: 1, stdout: '' },
      { status: 0, stdout: 'invalid\n' },
      { status: 0, stdout: '' },
    ]) {
      spawnSync.mockReturnValue(result)
      expect(() => signalFirewallProcessGroup(910_001, 'SIGKILL')).toThrow(
        error,
      )
    }
    expect(kill).toHaveBeenCalledTimes(6)
    spawnSync.mockImplementation(() => {
      throw new Error('fixture process listing unavailable')
    })
    expect(() => signalFirewallProcessGroup(910_001, 'SIGKILL')).toThrow(error)
    expect(kill.mock.calls.every(call => call[0] === -910_001)).toBe(true)
  })
  it('ignores unknown state markers in unrelated process groups', () => {
    const error = Object.assign(new Error('fixture permission'), {
      code: 'EPERM',
    })
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error
    })
    spawnSync.mockReturnValue({ status: 0, stdout: '910001 Z\n910002 ?s\n' })
    expect(() => signalFirewallProcessGroup(910_001, 'SIGKILL')).not.toThrow()
    spawnSync.mockReturnValue({ status: 0, stdout: '910001 ?s\n910002 Z\n' })
    expect(() => signalFirewallProcessGroup(910_001, 'SIGKILL')).toThrow(error)
  })
  it('parses process start identities and selects only descendants', () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout:
        ' 910001 1 Mon Sep 1 01:02:03 2026\r\n910002 910001 Mon Sep 1 01:02:04 2026\ninvalid\n910003 910002 Mon Sep 1 01:02:05 2026\n',
    })
    const rows = readFirewallProcesses()
    expect(rows).toHaveLength(3)
    expect(
      collectFirewallDescendants(910_001, [
        ...rows,
        { pid: process.pid, parent: 910_001, started: 'caller' },
      ]).map(entry => entry.pid),
    ).toEqual([910_002, 910_003])
  })
  it('treats unavailable process listings as unknown', () => {
    spawnSync.mockReturnValueOnce({ status: 1 }).mockImplementationOnce(() => {
      throw new Error('fixture unavailable')
    })
    expect(readFirewallProcesses()).toEqual([])
    expect(readFirewallProcesses()).toEqual([])
  })
  it('signals descendants in reverse order and refuses a reused PID', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    spawnSync.mockReturnValue({
      status: 0,
      stdout: '910002 1 current\n910003 1 nested\n910004 1 replacement\n',
    })
    signalFirewallDescendants(
      new Map([
        [910_002, { pid: 910_002, parent: 910_001, started: 'current' }],
        [910_003, { pid: 910_003, parent: 910_002, started: 'nested' }],
        [910_004, { pid: 910_004, parent: 910_001, started: 'original' }],
      ]),
      'SIGTERM',
    )
    expect(kill.mock.calls).toEqual([
      [910_003, 'SIGTERM'],
      [910_002, 'SIGTERM'],
    ])
  })
  it('ignores vanished processes but reports other signaling errors', () => {
    const kill = vi.spyOn(process, 'kill')
    spawnSync.mockReturnValue({ status: 0, stdout: '910002 1 current\n' })
    const known = new Map([
      [910_002, { pid: 910_002, parent: 910_001, started: 'current' }],
    ])
    kill.mockImplementation(() => {
      throw Object.assign(new Error('fixture missing'), { code: 'ESRCH' })
    })
    expect(() => signalFirewallDescendants(known, 'SIGTERM')).not.toThrow()
    expect(() => signalFirewallProcessGroup(910_001, 'SIGTERM')).not.toThrow()
    kill.mockImplementation(() => {
      throw Object.assign(new Error('fixture permission'), { code: 'EPERM' })
    })
    expect(() => signalFirewallDescendants(known, 'SIGTERM')).toThrow()
    expect(() => signalFirewallProcessGroup(910_001, 'SIGTERM')).toThrow()
  })
})

describe('controlling terminal probe', () => {
  it('recognizes a controlling terminal and closes the probe descriptor', () => {
    vi.mocked(openSync).mockReturnValue(910_005)
    vi.spyOn(tty, 'isatty').mockReturnValue(true)
    const close = vi.mocked(closeSync).mockImplementation(() => {})
    expect(hasFirewallControllingTerminal()).toBe(true)
    expect(close).toHaveBeenCalledWith(910_005)
  })
  it('treats an absent controlling terminal as detached', () => {
    vi.mocked(openSync).mockImplementation(() => {
      throw Object.assign(new Error('No controlling terminal'), {
        code: 'ENXIO',
      })
    })
    const close = vi.mocked(closeSync).mockImplementation(() => {})
    expect(hasFirewallControllingTerminal()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })
  it('closes a descriptor that is not a terminal', () => {
    vi.mocked(openSync).mockReturnValue(910_006)
    vi.spyOn(tty, 'isatty').mockReturnValue(false)
    const close = vi.mocked(closeSync).mockImplementation(() => {})
    expect(hasFirewallControllingTerminal()).toBe(false)
    expect(close).toHaveBeenCalledWith(910_006)
  })
})
