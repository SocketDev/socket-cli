/**
 * Unit tests for runSocketBasics — scan result handling and facts parsing.
 *
 * Spawns the socket-basics Python tool with extracted bundled binaries. Mocks
 * the VFS extractors, spawn, fs, and env helpers.
 *
 * Test Coverage:
 *
 * - BasicsResult null → "Failed to start"
 * - BasicsResult non-zero → "Socket-basics scan failed"
 * - Facts file missing post-scan → "not created" error
 * - Spinner stop/fail/success transitions around the basics scan
 * - ParseSocketFacts: empty file → ok with empty findings
 * - ParseSocketFacts: invalid JSON → ok with empty findings
 * - ParseSocketFacts: file read error → ok with empty findings
 * - ParseSocketFacts: well-formed JSON returns finding counts
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

describe('runSocketBasics — basics process result', () => {
  it('errors when basics spawn returns null', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args.includes('socket_basics') && args.includes('--org')) {
        return undefined as unknown
      }
      if (args[0] === '-c') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Failed to start socket-basics process')
    }
  })

  it('errors when basics process exits non-zero', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args.includes('socket_basics') && args.includes('--org')) {
        return { code: 1, stdout: '', stderr: 'basics boom' }
      }
      if (args[0] === '-c') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Socket-basics scan failed')
    }
  })

  it('uses spinner stop+fail when basics process exits non-zero (lines 362-363)', async () => {
    const stopSpy = vi.fn()
    const failSpy = vi.fn()
    const startSpy = vi.fn()
    const successSpy = vi.fn()
    const spinner = {
      start: startSpy,
      stop: stopSpy,
      fail: failSpy,
      success: successSpy,
    } as unknown
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args.includes('socket_basics') && args.includes('--org')) {
        return { code: 1, stdout: '', stderr: 'basics boom' }
      }
      if (args[0] === '-c') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics({ ...baseOpts, spinner })
    expect(result.ok).toBe(false)
    expect(stopSpy).toHaveBeenCalled()
    expect(failSpy).toHaveBeenCalled()
  })

  it('uses spinner stop+success on successful basics scan (lines 376-377)', async () => {
    const stopSpy = vi.fn()
    const failSpy = vi.fn()
    const startSpy = vi.fn()
    const successSpy = vi.fn()
    const spinner = {
      start: startSpy,
      stop: stopSpy,
      fail: failSpy,
      success: successSpy,
    } as unknown
    // Default mock returns code 0 for basics_socket call.
    const result = await runSocketBasics({ ...baseOpts, spinner })
    expect(result.ok).toBe(true)
    expect(successSpy).toHaveBeenCalled()
  })

  it('uses spinner fail when basicsResult is null (lines 350-351)', async () => {
    const stopSpy = vi.fn()
    const failSpy = vi.fn()
    const successSpy = vi.fn()
    const spinner = {
      start: vi.fn(),
      stop: stopSpy,
      fail: failSpy,
      success: successSpy,
    } as unknown
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args.includes('socket_basics') && args.includes('--org')) {
        // null result simulates spawn failure to start.
        return undefined as unknown
      }
      if (args[0] === '-c') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics({ ...baseOpts, spinner })
    expect(result.ok).toBe(false)
    expect(failSpy).toHaveBeenCalled()
  })

  it('errors when facts file is not created', async () => {
    // existsSync(python) returns true, existsSync(factsPath) returns false.
    let callIndex = 0
    mockExistsSync.mockImplementation(() => {
      callIndex++
      // First call is python check; second is the facts check after scan.
      return callIndex === 1
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Socket facts file not created')
    }
  })
})

describe('runSocketBasics — parseSocketFacts', () => {
  it('returns finding counts on a well-formed facts file', async () => {
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toMatchObject({
        sast: 2,
        secrets: 1,
        containers: 0,
      })
    }
  })

  it('returns empty findings when the facts file is empty', async () => {
    mockReadFile.mockResolvedValueOnce('')
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toEqual({})
    }
  })

  it('returns empty findings on whitespace-only facts content', async () => {
    mockReadFile.mockResolvedValueOnce('   \n\n')
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toEqual({})
    }
  })

  it('returns empty findings when JSON is malformed', async () => {
    mockReadFile.mockResolvedValueOnce('{not valid json')
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toEqual({})
    }
  })

  it('returns empty findings when fs.readFile throws', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('EACCES'))
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toEqual({})
    }
  })

  it('handles missing findings sub-keys with zero counts', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ findings: {} }))
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toMatchObject({
        sast: 0,
        secrets: 0,
        containers: 0,
      })
    }
  })

  it('handles top-level facts with no findings field', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({}))
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.findings).toMatchObject({
        sast: 0,
        secrets: 0,
        containers: 0,
      })
    }
  })
})
