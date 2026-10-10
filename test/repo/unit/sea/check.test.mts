import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  files: new Map<string, string | Buffer>(),
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: async (file: string) => fixture.files.get(file),
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: fixture.spawn,
}))

import { main } from '../../../../scripts/repo/cli-build/sea/check.mts'
import {
  SEA_ENTRYPOINT_PATHS,
  SEA_PAYLOAD_PATH,
  SEA_RECEIPT_PATH,
  seaBinaryPath,
} from '../../../../scripts/repo/cli-build/sea/paths.mts'
import { SEA_TARGETS } from '../../../../scripts/repo/cli-build/sea/targets.mts'

describe('SEA package verification', () => {
  beforeEach(() => {
    fixture.files.clear()
    fixture.spawn
      .mockReset()
      .mockResolvedValue({ code: 0, stdout: 'socket', stderr: '' })
    const bytes = Buffer.from('example executable')
    const digest = createHash('sha256').update(bytes).digest('hex')
    fixture.files.set(SEA_PAYLOAD_PATH, bytes)
    for (const file of Object.values(SEA_ENTRYPOINT_PATHS))
      fixture.files.set(file, bytes)
    for (const target of SEA_TARGETS)
      fixture.files.set(seaBinaryPath(target), bytes)
    fixture.files.set(
      SEA_RECEIPT_PATH,
      JSON.stringify({
        payload: digest,
        entrypoints: Object.fromEntries(
          Object.keys(SEA_ENTRYPOINT_PATHS).map(name => [name, digest]),
        ),
        binaries: Object.fromEntries(
          SEA_TARGETS.map(target => [target, digest]),
        ),
      }),
    )
  })

  it('executes the host smoke tests only after verifying the payload', async () => {
    await main()
    expect(fixture.spawn).toHaveBeenCalledTimes(3)
  })

  it('rejects a modified binary before executing it', async () => {
    fixture.files.set(
      seaBinaryPath(SEA_TARGETS[0]),
      Buffer.from('modified executable'),
    )
    await expect(main()).rejects.toThrow()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('rejects a host executable that fails its smoke test', async () => {
    fixture.spawn.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'example failure',
    })
    await expect(main()).rejects.toThrow()
  })
})
