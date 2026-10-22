import { describe, expect, it, vi } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { enumerateWorkspaces } from './run.mts'

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(async () => ({ code: 0, stderr: '', stdout: '' })),
}))

describe('build tool output', () => {
  it.each([
    ['inherit', ['inherit', 2, 'inherit']],
    ['pipe', 'pipe'],
  ] as const)(
    'maps stdio %s so stdout stays free of build logs',
    async (stdio, expected) => {
      vi.mocked(spawn).mockClear()
      await enumerateWorkspaces('gradle', {
        bin: 'gradle',
        projectDir: process.cwd(),
        stdio,
      }).catch(() => {})
      expect(vi.mocked(spawn).mock.calls[0]?.[2]?.stdio).toEqual(expected)
    },
  )
})
