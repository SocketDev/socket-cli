import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runtimeConstantsAttribs } from './runtime.mts'

let directory: string

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    // Keep installed copies in common system directories out of these tests.
    statSync: (filename: string, options?: { throwIfNoEntry?: boolean }) =>
      filename.startsWith(directory + path.sep)
        ? fs.statSync(filename, options)
        : undefined,
  }
})

describe('pnpm executable discovery', () => {
  const binName = process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm'

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'socket-real-pnpm-'))
    vi.stubEnv('PATHEXT', '.CMD')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(directory, { force: true, recursive: true })
  })

  function addCandidate(folder: string, mode: number): string {
    const candidateDir = path.join(directory, folder)
    mkdirSync(candidateDir)
    const candidate = path.join(candidateDir, binName)
    writeFileSync(candidate, '')
    chmodSync(candidate, mode)
    return candidate
  }

  it.skipIf(process.platform === 'win32')(
    'skips a pnpm file without execute permission',
    () => {
      const nonExecutable = addCandidate('non-executable', 0o644)
      const executable = addCandidate('executable', 0o755)
      vi.stubEnv(
        'PATH',
        [nonExecutable, executable]
          .map(file => path.dirname(file))
          .join(path.delimiter),
      )

      expect(runtimeConstantsAttribs.getters.pnpmExecPath()).toBe(executable)
    },
  )

  it.each([
    'shadow-bin',
    'shadow-npm-bin',
    'shadow-pnpm-bin',
    'shadow-yarn-bin',
  ])('skips %s when a real pnpm is available', shadowDir => {
    const shadow = addCandidate(shadowDir, 0o755)
    const executable = addCandidate('executable', 0o755)
    vi.stubEnv(
      'PATH',
      [shadow, executable].map(file => path.dirname(file)).join(path.delimiter),
    )

    expect(runtimeConstantsAttribs.getters.pnpmExecPath()).toBe(executable)
  })
})
