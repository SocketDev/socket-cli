/**
 * Unit tests for convertSbtToMaven.
 *
 * Spawns sbt makePom; collects "Wrote <path>.pom" lines from stdout to
 * determine the produced pom files. Tests cover stderr handling, no-pom
 * detection, single/multi-file stdout output, --verbose logging, and exception
 * handling.
 *
 * Related Files:
 *
 * - Src/commands/manifest/convert-sbt-to-maven.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
}))
const mockSpawn = vi.hoisted(() => vi.fn())
const mockSafeReadFile = vi.hoisted(() => vi.fn(async () => 'pom-content'))
const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))
const mockFindSystemTool = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/read-file'), () => ({
  safeReadFile: mockSafeReadFile,
}))
vi.mock(import('@socketsecurity/lib-stable/spinner/default'), () => ({
  getDefaultSpinner: () => mockSpinner,
}))
vi.mock(
  import('../../../../src/util/spawn/system-tool.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    findSystemTool: mockFindSystemTool,
  }),
)

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import {
  convertSbtToMaven,
  findProjectRootAboveTarget,
  resolveSbtExecutable,
} from '../../../../src/commands/manifest/convert-sbt-to-maven.mts'

const SYSTEM_SBT = '/usr/local/bin/sbt'
const SAFE_PATH = '/usr/local/bin:/usr/bin'

const baseOpts = {
  bin: 'sbt',
  cwd: '/proj',
  out: 'output.pom.xml',
  outputKind: 'text' as const,
  sbtOpts: [],
  verbose: false,
}

describe('convertSbtToMaven', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockFindSystemTool.mockResolvedValue({
      executable: SYSTEM_SBT,
      searchPath: SAFE_PATH,
    })
  })

  it('returns error when sbt writes to stderr', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: 'compile failed',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('returns error when no poms were generated', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'no relevant lines',
      stderr: '',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('not have generated any poms')
    }
  })

  it('parses Wrote <path>.pom lines from stdout', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/a.pom\nWrote /proj/b.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.files).toEqual(['/proj/a.pom', '/proj/b.pom'])
    }
  })

  it('writes single-file pom to stdout when out=- and one pom exists', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven({ ...baseOpts, out: '-' })

    expect(result.ok).toBe(true)
    expect(mockSafeReadFile).toHaveBeenCalledWith('/proj/foo.pom')
  })

  it('errors when out=- but multiple poms exist', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/a.pom\nWrote /proj/b.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven({ ...baseOpts, out: '-' })

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
    if (!result.ok) {
      expect(result.message).toContain('multiple generated files')
    }
  })

  it('repeats the failure header when there are >10 poms with out=-', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Wrote /proj/p${i}.pom`)
    mockSpawn.mockResolvedValueOnce({
      stdout: lines.join('\n') + '\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, out: '-' })

    // logger.fail is called twice — once before the file list, once after.
    expect(mockLogger.fail).toHaveBeenCalledTimes(2)
  })

  it('logs verbose stdout when --verbose is set', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.group).toHaveBeenCalledWith('[VERBOSE] sbt stdout:')
  })

  it('skips text-mode logging when outputKind is json', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, outputKind: 'json' })

    expect(mockLogger.success).not.toHaveBeenCalled()
  })

  it('returns failure when spawn throws', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('command failed'))

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(process.exitCode).toBe(1)
    if (!result.ok) {
      expect(result.cause).toContain('command failed')
    }
  })

  it('logs verbose error details when --verbose and spawn throws', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('command failed'))

    await convertSbtToMaven({ ...baseOpts, verbose: true })

    expect(mockLogger.group).toHaveBeenCalledWith('[VERBOSE] error:')
  })

  it('forwards sbtOpts to the spawn invocation', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven({ ...baseOpts, sbtOpts: ['--debug', '--noisy'] })

    expect(mockSpawn).toHaveBeenCalledWith(
      SYSTEM_SBT,
      ['makePom', '--debug', '--noisy'],
      expect.any(Object),
    )
  })

  it('spawns the resolved absolute sbt, never the bare name', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven(baseOpts)

    const call = mockSpawn.mock.calls.at(-1)
    expect(call?.[0]).toBe(SYSTEM_SBT)
    expect(call?.[0]).not.toBe('sbt')
  })

  it('hands the child the sanitized PATH', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/foo.pom\n',
      stderr: '',
    })

    await convertSbtToMaven(baseOpts)

    const options = mockSpawn.mock.calls.at(-1)?.[2] as {
      env?: Record<string, string | undefined> | undefined
    }
    expect(options.env?.['PATH']).toBe(SAFE_PATH)
  })

  it('fails with an actionable message instead of spawning the bare name', async () => {
    mockFindSystemTool.mockResolvedValue(undefined)

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(false)
    expect(mockSpawn).not.toHaveBeenCalled()
    if (!result.ok) {
      expect(result.message).toContain('`sbt`')
      expect(result.cause).toContain('untrusted checkout')
      expect(result.cause).toContain('brew install sbt')
    }
  })
})

describe('resolveSbtExecutable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindSystemTool.mockResolvedValue({
      executable: SYSTEM_SBT,
      searchPath: SAFE_PATH,
    })
  })

  it('resolves a bare name through the trusted lookup', async () => {
    const result = await resolveSbtExecutable('sbt', '/proj')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.executable).toBe(SYSTEM_SBT)
      expect(result.data.environment?.['PATH']).toBe(SAFE_PATH)
    }
    expect(mockFindSystemTool).toHaveBeenCalledWith('sbt', { cwd: '/proj' })
  })

  it('spawns an operator-named path as written', async () => {
    const result = await resolveSbtExecutable('./tools/sbt', '/proj')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.executable).toBe('./tools/sbt')
      expect(result.data.environment).toBeUndefined()
    }
    expect(mockFindSystemTool).not.toHaveBeenCalled()
  })

  it('spawns an operator-named Windows path as written', async () => {
    const result = await resolveSbtExecutable('C:\\tools\\sbt.bat', '/proj')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.executable).toBe('C:\\tools\\sbt.bat')
    }
    expect(mockFindSystemTool).not.toHaveBeenCalled()
  })
})

describe('findProjectRootAboveTarget', () => {
  it('returns the parent of the nearest target ancestor', () => {
    expect(
      findProjectRootAboveTarget('/proj/module/target/scala-2.13/foo.pom'),
    ).toBe('/proj/module')
  })

  it('returns the parent when the pom sits directly in target', () => {
    expect(findProjectRootAboveTarget('/proj/target/foo.pom')).toBe('/proj')
  })

  it('returns undefined when no target ancestor exists', () => {
    expect(findProjectRootAboveTarget('/proj/module/foo.pom')).toBeUndefined()
  })
})

describe('convertSbtToMaven target/ lift-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockFindSystemTool.mockResolvedValue({
      executable: SYSTEM_SBT,
      searchPath: SAFE_PATH,
    })
  })

  it('copies poms out of target/ to the project root', async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sbt-liftout-'))
    try {
      const targetDir = path.join(scratch, 'module', 'target', 'scala-2.13')
      await fs.mkdir(targetDir, { recursive: true })
      const pomA = path.join(targetDir, 'a.pom')
      const pomB = path.join(targetDir, 'b.pom')
      await fs.writeFile(pomA, '<project>a</project>')
      await fs.writeFile(pomB, '<project>b</project>')
      mockSpawn.mockResolvedValueOnce({
        stdout: `Wrote ${pomA}\nWrote ${pomB}\n`,
        stderr: '',
      })

      const result = await convertSbtToMaven({
        ...baseOpts,
        cwd: scratch,
        out: 'pom.xml',
      })

      expect(result.ok).toBe(true)
      const lifted = path.join(scratch, 'module', 'pom.xml')
      if (result.ok) {
        expect(result.data.files).toEqual([lifted, lifted])
      }
      expect(await fs.readFile(lifted, 'utf8')).toBe('<project>b</project>')
    } finally {
      await safeDelete(scratch)
    }
  })

  it('honors a full --out path for a single generated pom', async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'sbt-liftout-'))
    try {
      const targetDir = path.join(scratch, 'target')
      await fs.mkdir(targetDir, { recursive: true })
      const pom = path.join(targetDir, 'only.pom')
      await fs.writeFile(pom, '<project>only</project>')
      mockSpawn.mockResolvedValueOnce({
        stdout: `Wrote ${pom}\n`,
        stderr: '',
      })

      const result = await convertSbtToMaven({
        ...baseOpts,
        cwd: scratch,
        out: 'nested/dir/output.pom.xml',
      })

      expect(result.ok).toBe(true)
      const dest = path.join(scratch, 'nested', 'dir', 'output.pom.xml')
      if (result.ok) {
        expect(result.data.files).toEqual([dest])
      }
      expect(await fs.readFile(dest, 'utf8')).toBe('<project>only</project>')
    } finally {
      await safeDelete(scratch)
    }
  })

  it('leaves a pom in place when it has no target ancestor', async () => {
    mockSpawn.mockResolvedValueOnce({
      stdout: 'Wrote /proj/a.pom\nWrote /proj/b.pom\n',
      stderr: '',
    })

    const result = await convertSbtToMaven(baseOpts)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.files).toEqual(['/proj/a.pom', '/proj/b.pom'])
    }
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
