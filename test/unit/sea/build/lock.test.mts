import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { acquireBuildLock } from '../../../../src/sea/build/lock.mts'

describe('SEA build lock', () => {
  it('fails fast on a concurrent output lock and releases it for later builds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sea-lock-test-'))
    const lockPath = path.join(directory, 'output.lock')
    const release = await acquireBuildLock(lockPath)
    await expect(acquireBuildLock(lockPath)).rejects.toThrow()
    await release()
    const releaseAgain = await acquireBuildLock(lockPath)
    await releaseAgain()
    await rm(directory, { recursive: true, force: true })
  })
})
