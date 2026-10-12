import { describe, expect, it, vi } from 'vitest'

import {
  DARWIN_PACKAGE_QUARANTINE_VALUE,
  qualifyDarwinPackageArtifact,
} from '../../../../../scripts/repo/build/sea/package/gatekeeper.mts'
import type {
  NativePackageProcessResult,
  NativePackageSpawnProcess,
} from '../../../../../scripts/repo/build/sea/package/process.mts'

const artifactPath = '/tmp/socket-native-package'

function processResult(
  options: Partial<NativePackageProcessResult> = {},
): NativePackageProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    ...options,
  }
}

describe('Darwin native package gatekeeper qualification', () => {
  it('verifies signature, sets and reads quarantine, then assesses execution', async () => {
    const spawnProcess = vi.fn<NativePackageSpawnProcess>()
    spawnProcess
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(
        processResult({ stdout: Buffer.from(DARWIN_PACKAGE_QUARANTINE_VALUE) }),
      )
      .mockResolvedValueOnce(processResult())

    await expect(
      qualifyDarwinPackageArtifact({
        artifactPath,
        platform: 'darwin',
        spawnProcess,
      }),
    ).resolves.toBeUndefined()
    expect(spawnProcess.mock.calls.map(call => [call[0], call[1]])).toEqual([
      ['codesign', ['--verify', '--strict', '--verbose=2', artifactPath]],
      [
        'xattr',
        [
          '-w',
          'com.apple.quarantine',
          DARWIN_PACKAGE_QUARANTINE_VALUE,
          artifactPath,
        ],
      ],
      ['xattr', ['-p', 'com.apple.quarantine', artifactPath]],
      ['spctl', ['--assess', '--type', 'execute', '--verbose=2', artifactPath]],
    ])
    expect(spawnProcess).toHaveBeenCalledWith(
      'codesign',
      expect.any(Array),
      expect.objectContaining({
        cwd: '/tmp',
        timeoutMs: 30_000,
        maxOutputBytes: 16 * 1024,
      }),
    )
  })

  it.each([
    { label: 'nonzero status', result: { code: 1 } },
    { label: 'signal', result: { signal: 'SIGTERM' as NodeJS.Signals } },
    { label: 'timeout', result: { timedOut: true } },
    { label: 'output overflow', result: { outputLimitExceeded: true } },
  ])('stops after a command reports $label', async ({ result }) => {
    const spawnProcess = vi.fn<NativePackageSpawnProcess>()
    spawnProcess.mockResolvedValue(processResult())
    spawnProcess.mockResolvedValueOnce(processResult(result))

    await expect(
      qualifyDarwinPackageArtifact({
        artifactPath,
        platform: 'darwin',
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: 'ERR_DARWIN_QUALIFICATION_COMMAND',
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })

  it('rejects a quarantine value that differs from the value set', async () => {
    const spawnProcess = vi.fn<NativePackageSpawnProcess>()
    spawnProcess
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(processResult())
      .mockResolvedValueOnce(
        processResult({ stdout: Buffer.from('different') }),
      )

    await expect(
      qualifyDarwinPackageArtifact({
        artifactPath,
        platform: 'darwin',
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: 'ERR_DARWIN_QUALIFICATION_QUARANTINE',
    })
    expect(spawnProcess).toHaveBeenCalledTimes(3)
  })

  it('rejects non-Darwin hosts without spawning commands', async () => {
    const spawnProcess = vi.fn<NativePackageSpawnProcess>()

    await expect(
      qualifyDarwinPackageArtifact({
        artifactPath,
        platform: 'linux',
        spawnProcess,
      }),
    ).rejects.toMatchObject({
      code: 'ERR_DARWIN_QUALIFICATION_PLATFORM',
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})
