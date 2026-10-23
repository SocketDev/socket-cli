import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { enumerateWorkspaces, runManifestScript } from './run.mts'

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

describe('shared sbt global base', () => {
  it("does not read the previous root's records when a build dies before writing", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sbt-shared-base-'))
    try {
      const recordsArg = (args: readonly string[]) =>
        args
          .find(a => a.startsWith('-Dsocket.recordsFile='))!
          .slice('-Dsocket.recordsFile='.length)
      vi.mocked(spawn).mockImplementationOnce((async (
        _bin: string,
        args: readonly string[],
      ) => {
        await fs.writeFile(
          recordsArg(args),
          'buildRoot\t/a\nroot\t0\troot\tcompile\t1\nnode\t0\tx:y:jar:1\tx\ty\t1\tjar\t\t1\t\n',
        )
        return { code: 0, stderr: '', stdout: '' }
      }) as any)
      vi.mocked(spawn).mockImplementationOnce((async () => ({
        code: 1,
        stderr: 'error: not found: value broken',
        stdout: '',
      })) as any)
      const opts = { bin: 'sbt', stdio: 'pipe' as const, tmpDir: base }
      const a = await runManifestScript('sbt', { ...opts, projectDir: base })
      const b = await runManifestScript('sbt', { ...opts, projectDir: base })
      expect(a.facts.components).toHaveLength(1)
      expect(b.code).toBe(1)
      expect(b.buildRoot).toBeUndefined()
      expect(b.facts.components).toHaveLength(0)
    } finally {
      await fs.rm(base, { force: true, recursive: true })
    }
  })
})
