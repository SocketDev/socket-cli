import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'
import { runCliBuild } from '../../../scripts/repo/build.mts'
import { main as runCliBundleBuild } from '../../../scripts/repo/build/run.mts'

vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: vi.fn(),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('single CLI build entry', () => {
  it('accepts an argument options object for the bundle build', async () => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
    vi.mocked(spawn).mockResolvedValue({
      code: 0,
      stdout: '',
      stderr: '',
    } as Awaited<ReturnType<typeof spawn>>)
    const args = ['--watch', '--quiet', '--mode=production'] as const

    await runCliBundleBuild({ args })

    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [
        '--max-old-space-size=8192',
        '.config/repo/cli/rolldown.cli.mts',
        '--watch',
        '--mode=production',
      ],
      expect.objectContaining({ stdio: 'inherit' }),
    )
  })

  it('runs one Node build and forwards its options', async () => {
    await runCliBuild({ args: ['--force', '--quiet'] })
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts/repo/build/run.mts'),
        '--force',
        '--quiet',
      ],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    )
  })

  it('propagates a failed build', async () => {
    const failure = new Error('example build failure')
    vi.mocked(spawn).mockRejectedValueOnce(failure)
    await expect(runCliBuild({ args: [] })).rejects.toBe(failure)
  })
})
