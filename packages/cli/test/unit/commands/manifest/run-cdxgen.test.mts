/**
 * Unit tests for run-cdxgen helpers.
 *
 * Covers the lockfile/node_modules probe and Node.js type detection that gate
 * the default `socket cdxgen` path against shipping empty-components SBOMs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindUp = vi.hoisted(() => vi.fn())
const mockSpawnCdxgenDlx = vi.hoisted(() => vi.fn())
const mockSpawnSynpDlx = vi.hoisted(() => vi.fn())
const mockSafeDeleteSync = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockIsYarnBerry = vi.hoisted(() => vi.fn(() => false))
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  promises: { readFile: mockReadFile },
}))

vi.mock(import('@socketsecurity/lib-stable/fs/safe'), () => ({
  safeDeleteSync: mockSafeDeleteSync,
}))

vi.mock(import('@socketsecurity/lib-stable/logger'), () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock(import('../../../../src/util/fs/find-up.mts'), () => ({
  findUp: mockFindUp,
}))

vi.mock(import('../../../../src/util/dlx/spawn.mts'), () => ({
  spawnCdxgenDlx: mockSpawnCdxgenDlx,
  spawnSynpDlx: mockSpawnSynpDlx,
}))

vi.mock(import('../../../../src/util/yarn/version.mts'), () => ({
  isYarnBerry: mockIsYarnBerry,
}))

const { detectNodejsCdxgenSources, isNodejsCdxgenType, runCdxgen } =
  await import('../../../../src/commands/manifest/run-cdxgen.mts')

describe('isNodejsCdxgenType', () => {
  it('treats an undefined type as Node.js (the cdxgen default)', () => {
    expect(isNodejsCdxgenType(undefined)).toBe(true)
    expect(isNodejsCdxgenType(undefined)).toBe(true)
  })

  it.each(['js', 'javascript', 'typescript', 'nodejs', 'npm', 'pnpm', 'ts'])(
    'recognizes %s as Node.js',
    type => {
      expect(isNodejsCdxgenType(type)).toBe(true)
    },
  )

  it.each(['python', 'java', 'go', 'rust'])('rejects %s', type => {
    expect(isNodejsCdxgenType(type)).toBe(false)
  })

  it('matches arrays containing at least one Node.js entry', () => {
    expect(isNodejsCdxgenType(['python', 'js'])).toBe(true)
    expect(isNodejsCdxgenType(['python', 'java'])).toBe(false)
  })

  it('returns false for non-string non-array types', () => {
    expect(isNodejsCdxgenType(42)).toBe(false)
    expect(isNodejsCdxgenType({} as unknown)).toBe(false)
    expect(isNodejsCdxgenType(true as unknown)).toBe(false)
  })
})

describe('detectNodejsCdxgenSources', () => {
  beforeEach(() => {
    mockFindUp.mockReset()
  })

  it('reports neither source when nothing is found', async () => {
    mockFindUp.mockResolvedValue(undefined)
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result).toEqual({ hasLockfile: false, hasNodeModules: false })
  })

  it('detects a pnpm-lock.yaml', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'pnpm-lock.yaml' ? '/x/pnpm-lock.yaml' : undefined,
      ),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(true)
    expect(result.hasNodeModules).toBe(false)
  })

  it('detects a package-lock.json', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'package-lock.json' ? '/x/package-lock.json' : undefined,
      ),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(true)
  })

  it('detects a yarn.lock', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'yarn.lock' ? '/x/yarn.lock' : undefined),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(true)
  })

  it('detects node_modules/', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'node_modules' ? '/x/node_modules' : undefined),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(false)
    expect(result.hasNodeModules).toBe(true)
  })
})

describe('runCdxgen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUp.mockResolvedValue(undefined)
    mockExistsSync.mockReturnValue(false)
    mockSpawnCdxgenDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({}),
      process: {},
      stdin: undefined,
    })
    mockSpawnSynpDlx.mockResolvedValue({
      spawnPromise: Promise.resolve({}),
    })
  })

  it('returns help args when --help is passed', async () => {
    const result = await runCdxgen({ help: true, _: [] })
    await result.spawnPromise

    expect(mockSpawnCdxgenDlx).toHaveBeenCalledWith(
      expect.arrayContaining(['--help']),
      expect.objectContaining({ agent: 'npm' }),
    )
  })

  it('uses pnpm agent when pnpm-lock.yaml is found', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'pnpm-lock.yaml' ? '/x/pnpm-lock.yaml' : undefined,
      ),
    )

    const result = await runCdxgen({ _: [] })
    await result.spawnPromise

    expect(mockSpawnCdxgenDlx).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ agent: 'pnpm' }),
    )
  })

  it('uses yarn agent when yarn.lock is found and yarn berry is detected', async () => {
    mockIsYarnBerry.mockReturnValueOnce(true)
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'yarn.lock' ? '/x/yarn.lock' : undefined),
    )

    const result = await runCdxgen({ _: [], type: 'java' })
    await result.spawnPromise

    expect(mockSpawnCdxgenDlx).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ agent: 'yarn' }),
    )
  })

  it('keeps original type when only package-lock.json exists', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'package-lock.json' ? '/x/package-lock.json' : undefined,
      ),
    )

    await runCdxgen({ _: [], type: 'js' })

    expect(mockSpawnSynpDlx).not.toHaveBeenCalled()
  })

  it('uses synp to create package-lock.json when only yarn.lock exists', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'yarn.lock' ? '/x/yarn.lock' : undefined),
    )

    const result = await runCdxgen({ _: [], type: 'js' })
    await result.spawnPromise

    expect(mockSpawnSynpDlx).toHaveBeenCalled()
    expect(mockSafeDeleteSync).toHaveBeenCalledWith('./package-lock.json')
  })

  it('handles synp failures gracefully and continues with cdxgen', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'yarn.lock' ? '/x/yarn.lock' : undefined),
    )
    mockSpawnSynpDlx.mockRejectedValueOnce(new Error('synp failed'))

    const result = await runCdxgen({ _: [], type: 'js' })
    await result.spawnPromise

    expect(mockSpawnCdxgenDlx).toHaveBeenCalled()
  })

  it('passes flag-style options through to cdxgen args', async () => {
    const result = await runCdxgen({
      _: [],
      babel: false,
      'install-deps': true,
      validate: false,
      output: '',
      lifecycle: 'build',
      flag1: true,
      something: 'value',
      list: ['a', 'b'],
    })
    await result.spawnPromise

    const args = mockSpawnCdxgenDlx.mock.calls[0]?.[0] as string[]
    expect(args).toContain('--no-babel')
    expect(args).toContain('--install-deps')
    expect(args).toContain('--no-validate')
    expect(args).toContain('--lifecycle')
    expect(args).toContain('build')
    expect(args).toContain('--flag1')
    expect(args).toContain('--something')
    expect(args).toContain('value')
  })

  it('warns when output BOM has empty components array', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ components: [] }))

    const result = await runCdxgen({
      _: [],
      output: 'bom.json',
      lifecycle: 'pre-build',
    })
    await result.spawnPromise

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('bom.json created'),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('empty "components"'),
    )
  })

  it('warns with non-pre-build lifecycle hint when components empty', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ components: [] }))

    const result = await runCdxgen({
      _: [],
      output: 'bom.json',
      lifecycle: 'build',
    })
    await result.spawnPromise

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('--type'),
    )
  })

  it('does not warn when components are present', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ components: [{ name: 'foo' }] }),
    )

    const result = await runCdxgen({ _: [], output: 'bom.json' })
    await result.spawnPromise

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('rejects output paths outside the cwd', async () => {
    mockExistsSync.mockReturnValue(true)

    const result = await runCdxgen({ _: [], output: '../../escape.json' })
    await result.spawnPromise

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('outside the current working directory'),
    )
  })

  it('handles BOM read failures silently', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockRejectedValueOnce(new Error('read failed'))

    const result = await runCdxgen({ _: [], output: 'bom.json' })
    await result.spawnPromise

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('handles malformed BOM JSON silently', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValueOnce('not json')

    const result = await runCdxgen({ _: [], output: 'bom.json' })
    await result.spawnPromise

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('forwards positional args after the double hyphen', async () => {
    const result = await runCdxgen({
      _: ['./project'],
      '--': ['extra', 'args'],
    } as unknown)
    await result.spawnPromise

    const args = mockSpawnCdxgenDlx.mock.calls[0]?.[0] as string[]
    expect(args).toContain('./project')
    expect(args).toContain('--')
    expect(args).toContain('extra')
  })

  it('expands Array-valued flags into multiple --key value pairs', async () => {
    const { argvObjectToArray } =
      await import('../../../../src/commands/manifest/run-cdxgen.mts')
    // Array value → push --key followed by every entry stringified.
    const result = argvObjectToArray({
      filter: ['npm', 'pypi'],
    } as unknown)
    expect(result).toContain('--filter')
    expect(result).toContain('npm')
    expect(result).toContain('pypi')
  })

  it('emits --key when value is exactly true', async () => {
    const { argvObjectToArray } =
      await import('../../../../src/commands/manifest/run-cdxgen.mts')
    const result = argvObjectToArray({ recurse: true } as unknown)
    expect(result).toEqual(['--recurse'])
  })

  it('preserves --no-X form for negated lifecycle flags', async () => {
    const { argvObjectToArray } =
      await import('../../../../src/commands/manifest/run-cdxgen.mts')
    expect(
      argvObjectToArray({ babel: false, validate: false } as unknown),
    ).toEqual(['--no-babel', '--no-validate'])
  })

  it('emits --key value for string values', async () => {
    const { argvObjectToArray } =
      await import('../../../../src/commands/manifest/run-cdxgen.mts')
    expect(argvObjectToArray({ output: 'out.json' } as unknown)).toEqual([
      '--output',
      'out.json',
    ])
  })
})
