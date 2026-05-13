import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock whichBin so tests run with no bazel on PATH.
vi.mock('@socketsecurity/registry/lib/bin', () => ({
  whichBin: vi.fn(),
}))

import { whichBin } from '@socketsecurity/registry/lib/bin'

import { resolveBazelBinary } from './bazel-bin-detect.mts'

describe('resolveBazelBinary', () => {
  const mocked = vi.mocked(whichBin)

  beforeEach(() => {
    mocked.mockReset()
  })

  it('returns explicit path when it exists', async () => {
    // Use a path that definitely exists on every dev machine.
    const existing = process.execPath
    await expect(resolveBazelBinary(existing)).resolves.toBe(existing)
  })

  it('throws InputError when explicit path does not exist', async () => {
    await expect(
      resolveBazelBinary('/no/such/bazel/binary/xyz'),
    ).rejects.toThrow(/--bazel path does not exist/)
  })

  it('returns bazelisk when on PATH', async () => {
    mocked.mockResolvedValueOnce('/usr/local/bin/bazelisk')
    await expect(resolveBazelBinary(undefined)).resolves.toBe(
      '/usr/local/bin/bazelisk',
    )
  })

  it('falls back to bazel when bazelisk is missing', async () => {
    mocked
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/usr/local/bin/bazel')
    await expect(resolveBazelBinary(undefined)).resolves.toBe(
      '/usr/local/bin/bazel',
    )
  })

  it('throws InputError when neither is on PATH', async () => {
    mocked.mockResolvedValue(null)
    await expect(resolveBazelBinary(undefined)).rejects.toThrow(
      /Could not find bazelisk or bazel/,
    )
  })
})
