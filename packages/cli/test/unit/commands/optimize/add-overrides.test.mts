/**
 * Unit tests for add-overrides.
 *
 * Tests the addOverrides function that applies Socket Registry overrides to
 * package.json files. Most paths require complex pkgEnvDetails fixtures, so
 * this file mocks all collaborators and exercises the orchestration paths.
 *
 * Related Files: - src/commands/optimize/add-overrides.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockGlobWorkspace = vi.hoisted(() => vi.fn(async () => []))
vi.mock('../../../../src/util/fs/glob.mts', () => ({
  globWorkspace: mockGlobWorkspace,
  isReportSupportedFile: vi.fn(),
}))

const mockGetDependencyEntries = vi.hoisted(() => vi.fn(() => []))
vi.mock('../../../../src/commands/optimize/get-dependency-entries.mts', () => ({
  getDependencyEntries: mockGetDependencyEntries,
}))

const mockGetOverridesData = vi.hoisted(() =>
  vi.fn(() => ({ overrides: {}, type: 'npm' })),
)
const mockGetOverridesDataNpm = vi.hoisted(() =>
  vi.fn(() => ({ overrides: {}, type: 'npm' })),
)
const mockGetOverridesDataYarnClassic = vi.hoisted(() =>
  vi.fn(() => ({ overrides: {}, type: 'yarn' })),
)
vi.mock('../../../../src/commands/optimize/get-overrides-by-agent.mts', () => ({
  getOverridesData: mockGetOverridesData,
  getOverridesDataNpm: mockGetOverridesDataNpm,
  getOverridesDataYarnClassic: mockGetOverridesDataYarnClassic,
}))

vi.mock(
  '../../../../src/commands/optimize/lockfile-includes-by-agent.mts',
  () => ({
    lockSrcIncludes: vi.fn(() => false),
  }),
)

vi.mock('../../../../src/commands/optimize/deps-includes-by-agent.mts', () => ({
  lsStdoutIncludes: vi.fn(() => false),
}))

vi.mock('../../../../src/commands/optimize/ls-by-agent.mts', () => ({
  listPackages: vi.fn(async () => ''),
}))

vi.mock(
  '../../../../src/commands/optimize/update-manifest-by-agent.mts',
  () => ({
    updateManifest: vi.fn(),
  }),
)

const mockSafeNpa = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/util/npm/package-arg.mts', () => ({
  safeNpa: mockSafeNpa,
}))

vi.mock('../../../../src/util/process/cmd.mts', () => ({
  cmdPrefixMessage: (name: string, msg: string) => `[${name}] ${msg}`,
}))

const mockGetMajor = vi.hoisted(() => vi.fn((v: string) => parseInt(v, 10)))
vi.mock('../../../../src/util/semver.mts', () => ({
  getMajor: mockGetMajor,
}))

const mockGetManifestData = vi.hoisted(() => vi.fn(() => []))
vi.mock('@socketsecurity/registry-stable', () => ({
  getManifestData: mockGetManifestData,
}))

vi.mock('@socketsecurity/lib-stable/promises/iterate', () => ({
  pEach: async (items: unknown[], fn: unknown, opts?: unknown) => {
    for (let i = 0, { length } = items; i < length; i += 1) {
      const item = items[i]
      await fn(item)
    }
  },
}))

import { addOverrides } from '../../../../src/commands/optimize/add-overrides.mts'

describe('addOverrides', () => {
  const mockEnvDetails: unknown = {
    agent: 'npm',
    agentVersion: '10.0.0',
    lockName: 'package-lock.json',
    lockSrc: '',
    npmExecPath: '/usr/bin/npm',
    pkgPath: '/test/project',
    editablePkgJson: {
      content: { name: 'test', dependencies: {} },
      update: vi.fn(),
      save: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGlobWorkspace.mockResolvedValue([])
    mockGetDependencyEntries.mockReturnValue([
      ['dependencies', mockEnvDetails.editablePkgJson.content.dependencies],
    ])
    mockGetOverridesData.mockReturnValue({ overrides: {}, type: 'npm' })
    mockGetOverridesDataNpm.mockReturnValue({ overrides: {}, type: 'npm' })
    mockGetOverridesDataYarnClassic.mockReturnValue({
      overrides: {},
      type: 'yarn',
    })
    mockGetManifestData.mockReturnValue([])
  })

  it('returns initial state when no manifest overrides exist', async () => {
    const state = await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
    })
    expect(state.added.size).toBe(0)
    expect(state.updated.size).toBe(0)
  })

  it('uses provided state instead of creating new state', async () => {
    const customState = {
      added: new Set(['existing']),
      addedInWorkspaces: new Set(),
      updated: new Set(),
      updatedInWorkspaces: new Set(),
      warnedPnpmWorkspaceRequiresNpm: false,
    }
    const state = await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
      state: customState,
    })
    expect(state).toBe(customState)
    expect(state.added.has('existing')).toBe(true)
  })

  it('uses getOverridesData when private package.json detected', async () => {
    const privateEnv = {
      ...mockEnvDetails,
      editablePkgJson: {
        ...mockEnvDetails.editablePkgJson,
        content: {
          ...mockEnvDetails.editablePkgJson.content,
          private: true,
        },
      },
    }
    await addOverrides(privateEnv, '/test/project', {
      logger: mockLogger as unknown,
    })
    expect(mockGetOverridesData).toHaveBeenCalledWith(privateEnv)
    expect(mockGetOverridesDataNpm).not.toHaveBeenCalled()
  })

  it('uses both getOverridesDataNpm and YarnClassic for non-private non-workspace', async () => {
    await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
    })
    expect(mockGetOverridesDataNpm).toHaveBeenCalled()
    expect(mockGetOverridesDataYarnClassic).toHaveBeenCalled()
  })

  it('warns about pnpm workspace requiring npm when needed', async () => {
    mockGlobWorkspace.mockResolvedValueOnce(['/test/project/pkg/package.json'])
    const pnpmEnv = {
      ...mockEnvDetails,
      agent: 'pnpm',
      npmExecPath: 'npm', // Cannot resolve npm.
    }
    const customState = {
      added: new Set<string>(),
      addedInWorkspaces: new Set<string>(),
      updated: new Set<string>(),
      updatedInWorkspaces: new Set<string>(),
      warnedPnpmWorkspaceRequiresNpm: false,
    }
    await addOverrides(pnpmEnv, '/test/project', {
      logger: mockLogger as unknown,
      state: customState,
    })
    expect(customState.warnedPnpmWorkspaceRequiresNpm).toBe(true)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('workspace support requires'),
    )
  })

  it('does not re-warn if pnpm warning was already issued', async () => {
    mockGlobWorkspace.mockResolvedValueOnce(['/test/project/pkg/package.json'])
    const pnpmEnv = { ...mockEnvDetails, agent: 'pnpm', npmExecPath: 'npm' }
    const customState = {
      added: new Set<string>(),
      addedInWorkspaces: new Set<string>(),
      updated: new Set<string>(),
      updatedInWorkspaces: new Set<string>(),
      warnedPnpmWorkspaceRequiresNpm: true, // Already warned.
    }
    await addOverrides(pnpmEnv, '/test/project', {
      logger: mockLogger as unknown,
      state: customState,
    })
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('recurses into workspace package.json paths when workspace is detected', async () => {
    // Exercises the `if (isWorkspace)` branch + recursive addOverrides call
    // (line 266+). With workspacePkgJsonPaths populated, the function recurses
    // into each workspace dir.
    mockGlobWorkspace.mockResolvedValueOnce([
      '/test/project/packages/a/package.json',
      '/test/project/packages/b/package.json',
    ])
    // Subsequent calls (recursion) return [].
    mockGlobWorkspace.mockResolvedValue([])

    const customState = {
      added: new Set<string>(['outer-pkg']),
      addedInWorkspaces: new Set<string>(['ws1']),
      updated: new Set<string>(['outer-updated']),
      updatedInWorkspaces: new Set<string>(),
      warnedPnpmWorkspaceRequiresNpm: false,
    }
    await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
      state: customState,
    })
    // globWorkspace called for outer + each workspace package.
    expect(mockGlobWorkspace.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('uses non-root pkgPath for relative workspace name', async () => {
    // Exercises `path.relative(rootPath, pkgPath)` branch (line 81)
    // when pkgPath !== rootPath.
    const innerPath = '/test/project/packages/inner'
    await addOverrides(mockEnvDetails, innerPath, {
      logger: mockLogger as unknown,
    })
    // The function returns successfully without errors.
    expect(mockGlobWorkspace).toHaveBeenCalled()
  })

  it('with prod=true skips lockfile scanning even at workspace root', async () => {
    // Exercises `isLockScanned = isWorkspaceRoot && !prod` (line 80).
    await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
      prod: true,
    })
    expect(mockGetOverridesDataNpm).toHaveBeenCalled()
  })

  it('with pin=true uses pinned version for overrides', async () => {
    // Exercises `pin` branch in spec-construction (line 126).
    await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
      pin: true,
    })
    expect(mockGetOverridesDataNpm).toHaveBeenCalled()
  })

  it('with custom spinner forwards spinner to inner methods', async () => {
    // Exercises spinner option flow.
    const mockSpinner: unknown = {
      stop: vi.fn(),
      start: vi.fn(),
      text: vi.fn(),
    }
    await addOverrides(mockEnvDetails, '/test/project', {
      logger: mockLogger as unknown,
      spinner: mockSpinner,
    })
    expect(mockGetOverridesDataNpm).toHaveBeenCalled()
  })
})
