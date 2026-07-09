/**
 * Unit tests for runSocketBasics — preflight checks and Python CLI
 * installation.
 *
 * Spawns the socket-basics Python tool with extracted bundled binaries. Mocks
 * the VFS extractors, spawn, fs, and env helpers.
 *
 * Test Coverage:
 *
 * - Basics tools unavailable → "Basics tools not available"
 * - VFS extraction returns null → "Failed to extract basics tools"
 * - Python binary missing after extraction → "Python not found"
 * - PyCli already installed (skip pip install) → proceeds
 * - PyCli not installed → pip install path; null spawn / non-zero exit / wrong
 *   version cases
 * - Socket_basics not installed → "must be pre-bundled" error
 *
 * Related Files:
 *
 * - Src/util/basics/spawn.mts - Implementation
 * - Src/util/basics/vfs-extract.mts - tool availability + extraction (mocked)
 * - Src/util/basics/spawn-arguments.test.mts - argument construction tests
 * - Src/util/basics/spawn-scan-result.test.mts - scan result + facts parsing
 *   tests
 * - Src/util/basics/spawn-installed-checks.test.mts - isSocketPyCliInstalled /
 *   isSocketBasicsInstalled tests
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

describe('runSocketBasics — preflight failures', () => {
  it('returns "Basics tools not available" when bundled tools are missing', async () => {
    mockAreBasicsToolsAvailable.mockReturnValue(false)
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Basics tools not available')
    }
  })

  it('returns "Failed to extract basics tools" when extraction returns null', async () => {
    mockExtractBasicsTools.mockResolvedValueOnce(undefined)
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Failed to extract basics tools')
    }
  })

  it('returns "Python not found" when python is absent after extraction', async () => {
    // First existsSync (check python) returns false.
    mockExistsSync.mockReturnValueOnce(false)
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Python not found')
    }
  })
})

describe('runSocketBasics — pyCli installation', () => {
  it('skips pip install when socketsecurity is already installed', async () => {
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    // No pip install or pip show calls.
    const pipInstall = mockSpawn.mock.calls.find(
      c => Array.isArray(c[1]) && c[1].includes('install'),
    )
    expect(pipInstall).toBeUndefined()
  })

  it('runs pip install when socketsecurity is not installed', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 1, stdout: '', stderr: 'no module' }
      }
      if (args[1]?.includes('socket_basics')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args.includes('install')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args.includes('show')) {
        return { code: 0, stdout: 'Version: 1.2.3\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(true)
    const pipInstall = mockSpawn.mock.calls.find(c =>
      (c[1] as string[]).includes('install'),
    )
    expect(pipInstall).toBeDefined()
  })

  it('errors when pip install spawn returns null', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      if (args.includes('install')) {
        return undefined as unknown
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Failed to start pip install process')
    }
  })

  it('errors when pip install exits with non-zero code', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      if (args.includes('install')) {
        return { code: 1, stdout: '', stderr: 'pip install boom' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Failed to install Socket Python CLI')
    }
  })

  it('errors when pip show fails after install', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      if (args.includes('install')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args.includes('show')) {
        return { code: 1, stdout: '', stderr: 'pip show boom' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('verify')
    }
  })

  it('errors when installed version does not match expected version', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      if (args.includes('install')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args.includes('show')) {
        return { code: 0, stdout: 'Version: 9.9.9\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Socket Python CLI version mismatch')
    }
  })

  it('handles pip show output with no Version line', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      if (args.includes('install')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args.includes('show')) {
        return { code: 0, stdout: 'Name: socketsecurity\n', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('Socket Python CLI version mismatch')
    }
  })
})

describe('runSocketBasics — socket_basics presence', () => {
  it('errors when socket_basics is not pre-installed', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args[1]?.includes('socketsecurity.socketcli')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[1]?.includes('socket_basics')) {
        return { code: 1, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    })
    const result = await runSocketBasics(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBe('socket_basics package not installed')
    }
  })
})
