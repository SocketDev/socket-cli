/**
 * Unit tests for runSocketBasics.
 *
 * Spawns the socket-basics Python tool with extracted bundled binaries.
 * Mocks the VFS extractors, spawn, fs, and env helpers.
 *
 * Test Coverage:
 * - basics tools unavailable → "Basics tools not available"
 * - VFS extraction returns null → "Failed to extract basics tools"
 * - Python binary missing after extraction → "Python not found"
 * - PyCli already installed (skip pip install) → proceeds
 * - PyCli not installed → pip install path; null spawn / non-zero
 *   exit / wrong version cases
 * - socket_basics not installed → "must be pre-bundled" error
 * - Default args (no languages, scanSecrets=true, scanContainers=false)
 * - languages list adds --languages csv
 * - scanContainers=true adds --containers
 * - Custom outputPath used as facts path
 * - Default factsPath is cwd/.socket.facts.json
 * - basicsResult null → "Failed to start"
 * - basicsResult non-zero → "Socket-basics scan failed"
 * - facts file missing post-scan → "not created" error
 * - parseSocketFacts: empty file → ok with empty findings
 * - parseSocketFacts: invalid JSON → ok with empty findings
 * - parseSocketFacts: file read error → ok with empty findings
 * - parseSocketFacts: well-formed JSON returns finding counts
 *
 * Related Files:
 * - src/utils/basics/spawn.mts - Implementation
 * - src/utils/basics/vfs-extract.mts - tool availability + extraction (mocked)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    promises: { readFile: mockReadFile },
  },
  existsSync: mockExistsSync,
  promises: { readFile: mockReadFile },
}))

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../../../src/utils/basics/vfs-extract.mts', () => ({
  areBasicsToolsAvailable: mockAreBasicsToolsAvailable,
  extractBasicsTools: mockExtractBasicsTools,
  getBasicsToolPaths: mockGetBasicsToolPaths,
}))

vi.mock('../../../../src/env/pycli-version.mts', () => ({
  getPyCliVersion: mockGetPyCliVersion,
}))

vi.mock('../../../../src/constants.mts', () => ({
  DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
}))

const { isSocketBasicsInstalled, isSocketPyCliInstalled, runSocketBasics } =
  await import('../../../../src/utils/basics/spawn.mts')

const baseOpts = {
  cwd: '/work',
  orgSlug: 'org',
  repoName: 'repo',
}

const toolPaths = {
  python: '/tools/python',
  trivy: '/tools/trivy',
  trufflehog: '/tools/trufflehog',
  opengrep: '/tools/opengrep',
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
        return undefined as any
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

describe('runSocketBasics — basics process result', () => {
  it('errors when basics spawn returns null', async () => {
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args.includes('socket_basics') && args.includes('--org')) {
        return undefined as any
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
    } as any
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
    } as any
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
    } as any
    mockSpawn.mockImplementation(async (_bin, args: string[]) => {
      if (args.includes('socket_basics') && args.includes('--org')) {
        // null result simulates spawn failure to start.
        return undefined as any
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

describe('isSocketPyCliInstalled', () => {
  it('returns true when spawn exits with code 0', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    expect(await isSocketPyCliInstalled('/usr/bin/python3')).toBe(true)
  })

  it('returns false when spawn exits with non-zero code', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
    expect(await isSocketPyCliInstalled('/usr/bin/python3')).toBe(false)
  })

  it('returns false when spawn rejects (line 38)', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('python missing'))
    expect(await isSocketPyCliInstalled('/usr/bin/python3')).toBe(false)
  })
})

describe('isSocketBasicsInstalled', () => {
  it('returns true when spawn exits with code 0', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    expect(await isSocketBasicsInstalled('/usr/bin/python3')).toBe(true)
  })

  it('returns false when spawn exits with non-zero code', async () => {
    mockSpawn.mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
    expect(await isSocketBasicsInstalled('/usr/bin/python3')).toBe(false)
  })

  it('returns false when spawn rejects (line 54)', async () => {
    mockSpawn.mockRejectedValueOnce(new Error('python missing'))
    expect(await isSocketBasicsInstalled('/usr/bin/python3')).toBe(false)
  })
})
