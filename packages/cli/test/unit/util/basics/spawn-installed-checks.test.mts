/**
 * Unit tests for isSocketPyCliInstalled and isSocketBasicsInstalled.
 *
 * Mocks spawn to simulate the Python environment probes used before running
 * socket-basics.
 *
 * Test Coverage:
 *
 * - IsSocketPyCliInstalled: spawn code 0 / non-zero / rejects
 * - IsSocketBasicsInstalled: spawn code 0 / non-zero / rejects
 *
 * Related Files:
 *
 * - Src/util/basics/spawn.mts - Implementation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isSocketBasicsInstalled,
  isSocketPyCliInstalled,
} from '../../../../src/util/basics/spawn.mts'

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isSocketPyCliInstalled', () => {
  it('returns true when spawn exits with code 0', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    expect(await isSocketPyCliInstalled('/usr/bin/python3')).toBe(true)
  })

  it('returns false when spawn exits with non-zero code', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
    expect(await isSocketPyCliInstalled('/usr/bin/python3')).toBe(false)
  })

  it('returns false when spawn rejects (line 38)', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('python missing'))
    expect(await isSocketPyCliInstalled('/usr/bin/python3')).toBe(false)
  })
})

describe('isSocketBasicsInstalled', () => {
  it('returns true when spawn exits with code 0', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    expect(await isSocketBasicsInstalled('/usr/bin/python3')).toBe(true)
  })

  it('returns false when spawn exits with non-zero code', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
    expect(await isSocketBasicsInstalled('/usr/bin/python3')).toBe(false)
  })

  it('returns false when spawn rejects (line 54)', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('python missing'))
    expect(await isSocketBasicsInstalled('/usr/bin/python3')).toBe(false)
  })
})
