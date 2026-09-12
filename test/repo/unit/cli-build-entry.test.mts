import path from 'node:path'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'
import { runCliBuild } from '../../../scripts/repo/build.mts'

vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: vi.fn(),
}))
afterEach(() => {
  vi.clearAllMocks()
})

describe('single CLI build entry', () => {
  it('runs one Node build and forwards its options', async () => {
    await runCliBuild(['--force', '--quiet'])
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/repo/cli-build/build.mts'),
        '--force',
        '--quiet',
      ],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    )
  })

  it('propagates a failed build', async () => {
    const failure = new Error('example build failure')
    vi.mocked(spawn).mockRejectedValueOnce(failure)
    await expect(runCliBuild([])).rejects.toBe(failure)
  })
})
