/**
 * Unit tests for runSocketBasics — CLI argument construction.
 *
 * Spawns the socket-basics Python tool with extracted bundled binaries. Mocks
 * the VFS extractors, spawn, fs, and env helpers.
 *
 * Test Coverage:
 *
 * - Default args (no languages, scanSecrets=true, scanContainers=false)
 * - Languages list adds --languages csv
 * - ScanContainers=true adds --containers
 * - Custom outputPath used as facts path
 * - Default factsPath is cwd/.socket.facts.json
 * - PATH and SKIP_* env vars set on the basics process
 *
 * Related Files:
 *
 * - Src/util/basics/spawn.mts - Implementation
 * - Src/util/basics/vfs-extract.mts - tool availability + extraction (mocked)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runSocketBasics } from '../../../../src/util/basics/spawn.mts'

const {
  mockAreBasicsToolsAvailable,
  mockExistsSync,
  mockExtractBasicsTools,
  mockGetBasicsToolPaths,
  mockGetPyCliVersion,
  mockReadFile,
  mockSpawn,
} = vi.hoisted(() => ({
  mockAreBasicsToolsAvailable: vi.fn(),
  mockExistsSync: vi.fn(),
  mockExtractBasicsTools: vi.fn(),
  mockGetBasicsToolPaths: vi.fn(),
  mockGetPyCliVersion: vi.fn(),
  mockReadFile: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock(import('node:fs'), () => ({
  default: {
    existsSync: mockExistsSync,
    promises: { readFile: mockReadFile },
  },
  existsSync: mockExistsSync,
  promises: { readFile: mockReadFile },
}))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('../../../../src/util/basics/vfs-extract.mts'), () => ({
  areBasicsToolsAvailable: mockAreBasicsToolsAvailable,
  extractBasicsTools: mockExtractBasicsTools,
  getBasicsToolPaths: mockGetBasicsToolPaths,
}))

vi.mock(import('../../../../src/env/pycli-version.mts'), () => ({
  getPyCliVersion: mockGetPyCliVersion,
}))

vi.mock(import('../../../../src/constants.mts'), () => ({
  DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
}))

const baseOpts = {
  cwd: '/work',
  orgSlug: 'org',
  repoName: 'repo',
}

const toolPaths = {
  opengrep: '/tools/opengrep',
  python: '/tools/python',
  trivy: '/tools/trivy',
  trufflehog: '/tools/trufflehog',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAreBasicsToolsAvailable.mockReturnValue(true)
  mockExtractBasicsTools.mockResolvedValue('/tools')
  mockGetBasicsToolPaths.mockReturnValue(toolPaths)
  mockExistsSync.mockReturnValue(true)
  mockGetPyCliVersion.mockReturnValue('1.2.3')
  // Default spawn behavior: every spawn returns success.
  mockSpawn.mockImplementation(async (_bin, args: string[]) => {
    if (args[0] === '-c' && args[1]?.includes('socketsecurity.socketcli')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === '-c' && args[1]?.includes('socket_basics')) {
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args.includes('pip') && args.includes('show')) {
      return { code: 0, stdout: 'Version: 1.2.3\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  })
  // Default facts file content.
  mockReadFile.mockResolvedValue(
    JSON.stringify({
      findings: {
        sast: [{}, {}],
        secrets: [{}],
        containers: [],
      },
    }),
  )
})

describe('runSocketBasics — argument construction', () => {
  it('uses default cwd-relative facts path', async () => {
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // normalizePath converts the path so we just check it includes the trailing filename.
      expect(result.data.factsPath).toContain('.socket.facts.json')
    }
  })

  it('uses provided outputPath verbatim', async () => {
    const result = await runSocketBasics({
      ...baseOpts,
      outputPath: '/abs/path/facts.json',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.factsPath).toBe('/abs/path/facts.json')
    }
  })

  it('passes --languages csv when languages array is non-empty', async () => {
    await runSocketBasics({
      ...baseOpts,
      languages: ['python', 'javascript'],
    })
    const spawnedArgs = mockSpawn.mock.calls.at(-1)?.[1] as string[]
    expect(spawnedArgs).toContain('--languages')
    expect(spawnedArgs).toContain('python,javascript')
  })

  it('omits --languages when languages array is empty', async () => {
    await runSocketBasics({ ...baseOpts, languages: [] })
    const spawnedArgs = mockSpawn.mock.calls.at(-1)?.[1] as string[]
    expect(spawnedArgs).not.toContain('--languages')
  })

  it('adds --secrets when scanSecrets is true (default)', async () => {
    await runSocketBasics(baseOpts)
    const spawnedArgs = mockSpawn.mock.calls.at(-1)?.[1] as string[]
    expect(spawnedArgs).toContain('--secrets')
  })

  it('omits --secrets when scanSecrets is false', async () => {
    await runSocketBasics({ ...baseOpts, scanSecrets: false })
    const spawnedArgs = mockSpawn.mock.calls.at(-1)?.[1] as string[]
    expect(spawnedArgs).not.toContain('--secrets')
  })

  it('adds --containers when scanContainers is true', async () => {
    await runSocketBasics({ ...baseOpts, scanContainers: true })
    const spawnedArgs = mockSpawn.mock.calls.at(-1)?.[1] as string[]
    expect(spawnedArgs).toContain('--containers')
  })

  it('omits --containers by default', async () => {
    await runSocketBasics(baseOpts)
    const spawnedArgs = mockSpawn.mock.calls.at(-1)?.[1] as string[]
    expect(spawnedArgs).not.toContain('--containers')
  })

  it('sets PATH and SKIP_* env vars on the basics process', async () => {
    await runSocketBasics(baseOpts)
    const spawnOpts = mockSpawn.mock.calls.at(-1)?.[2] as {
      env: Record<string, string>
    }
    expect(spawnOpts.env['SKIP_SOCKET_REACH']).toBe('1')
    expect(spawnOpts.env['SKIP_SOCKET_SUBMISSION']).toBe('1')
    expect(spawnOpts.env['PATH']).toContain('/tools')
  })
})
