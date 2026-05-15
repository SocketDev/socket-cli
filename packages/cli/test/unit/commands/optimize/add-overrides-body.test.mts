/**
 * Unit tests for the body of addOverrides (the pEach loop over manifest entries).
 *
 * `manifestNpmOverrides = getManifestData(NPM) ?? []` is module-init, so to
 * exercise the loop body we use `vi.resetModules()` + `vi.doMock()` per test
 * to control what `getManifestData` returns at module-load time.
 *
 * Related Files:
 * - src/commands/optimize/add-overrides.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PackagesModule from '@socketsecurity/lib-stable/packages'

const mockLogger = {
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

const baseEnv = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
})

export async function loadAddOverrides(opts: {
  manifestEntries: Array<[string, unknown]>
  getMajor?: (v: string) => number | undefined
  safeNpa?: ((s: string) => unknown) | undefined
  fetchPackageManifest?: ((s: string) => Promise<unknown>) | undefined
  globWorkspace?: (() => Promise<string[]>) | undefined
  getDependencyEntries?: ((env: unknown) => unknown) | undefined
  getOverridesData?: ((env: unknown) => unknown) | undefined
  getOverridesDataNpm?: ((env: unknown) => unknown) | undefined
  getOverridesDataYarnClassic?: ((env: unknown) => unknown) | undefined
  lockSrcIncludes?: ((...args: unknown[]) => boolean) | undefined
  lsStdoutIncludes?: ((...args: unknown[]) => boolean) | undefined
  listPackages?: ((...args: unknown[]) => Promise<string>) | undefined
}) {
  const { manifestEntries } = opts
  vi.doMock('@socketsecurity/registry', () => ({
    getManifestData: (agent?: string) =>
      agent === 'npm' ? manifestEntries : [],
  }))
  vi.doMock('@socketsecurity/lib/promises', () => ({
    pEach: async (items: unknown[], fn: unknown) => {
      for (let i = 0, { length } = items; i < length; i += 1) {
        const item = items[i]
        await fn(item)
      }
    },
  }))
  vi.doMock('../../../../src/utils/fs/glob.mts', () => ({
    globWorkspace: opts.globWorkspace ?? vi.fn(async () => []),
    isReportSupportedFile: vi.fn(),
  }))
  vi.doMock(
    '../../../../src/commands/optimize/get-dependency-entries.mts',
    () => ({
      getDependencyEntries: opts.getDependencyEntries ?? vi.fn(() => []),
    }),
  )
  vi.doMock(
    '../../../../src/commands/optimize/get-overrides-by-agent.mts',
    () => ({
      getOverridesData:
        opts.getOverridesData ?? vi.fn(() => ({ overrides: {}, type: 'npm' })),
      getOverridesDataNpm:
        opts.getOverridesDataNpm ??
        vi.fn(() => ({ overrides: {}, type: 'npm' })),
      getOverridesDataYarnClassic:
        opts.getOverridesDataYarnClassic ??
        vi.fn(() => ({ overrides: {}, type: 'yarn' })),
    }),
  )
  vi.doMock(
    '../../../../src/commands/optimize/lockfile-includes-by-agent.mts',
    () => ({
      lockSrcIncludes: opts.lockSrcIncludes ?? vi.fn(() => false),
    }),
  )
  vi.doMock(
    '../../../../src/commands/optimize/deps-includes-by-agent.mts',
    () => ({
      lsStdoutIncludes: opts.lsStdoutIncludes ?? vi.fn(() => false),
    }),
  )
  vi.doMock('../../../../src/commands/optimize/ls-by-agent.mts', () => ({
    listPackages: opts.listPackages ?? vi.fn(async () => ''),
  }))
  vi.doMock(
    '../../../../src/commands/optimize/update-manifest-by-agent.mts',
    () => ({
      updateManifest: vi.fn(),
    }),
  )
  vi.doMock('../../../../src/utils/npm/package-arg.mts', () => ({
    safeNpa: opts.safeNpa ?? vi.fn(() => undefined),
  }))
  vi.doMock('../../../../src/utils/process/cmd.mts', () => ({
    cmdPrefixMessage: (name: string, msg: string) => `[${name}] ${msg}`,
  }))
  vi.doMock('../../../../src/utils/semver.mts', () => ({
    getMajor: opts.getMajor ?? vi.fn((v: string) => parseInt(v, 10)),
  }))
  if (opts.fetchPackageManifest) {
    vi.doMock('@socketsecurity/lib/packages', async importOriginal => {
      const actual = await importOriginal<typeof PackagesModule>()
      return {
        ...actual,
        fetchPackageManifest: opts.fetchPackageManifest,
      }
    })
  }

  const mod =
    await import('../../../../src/commands/optimize/add-overrides.mts')
  return mod.addOverrides
}

describe('addOverrides body (manifestNpmOverrides loop)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('skips entries when getMajor returns undefined (line 122-124)', async () => {
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: 'invalid' }],
      ],
      getMajor: vi.fn(() => undefined),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
    })
    expect(state.added.size).toBe(0)
  })

  it('adds an alias when origPkgName found in deps (line 158-167)', async () => {
    const depObj = { 'pkg-a-orig': '^1.0.0' }
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', depObj]]),
      getMajor: vi.fn(() => 1),
      safeNpa: vi.fn(() => undefined),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
    })
    expect(state.added.has('pkg-a')).toBe(true)
    expect(depObj['pkg-a-orig']).toMatch(/^npm:pkg-a@/)
  })

  it('keeps existing alias spec when it parses as a valid alias (line 142-156)', async () => {
    // origSpec already starts with the sockOverridePrefix and parses correctly,
    // so we should NOT replace it.
    const depObj = { 'pkg-a-orig': 'npm:pkg-a@1.5.0' }
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', depObj]]),
      getMajor: vi.fn(() => 1),
      safeNpa: vi.fn(() => ({
        type: 'alias',
        subSpec: { rawSpec: '1.5.0' },
      })),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
    })
    // The valid alias is preserved.
    expect(state.added.has('pkg-a')).toBe(false)
    expect(depObj['pkg-a-orig']).toBe('npm:pkg-a@1.5.0')
  })

  it('treats sockSpec match as alias too (line 128-133)', async () => {
    // depObj has the sock-registry name, not the orig name.
    const depObj = { 'pkg-a': '^1.0.0' }
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', depObj]]),
      getMajor: vi.fn(() => 1),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
    })
    // Without the orig spec, no add but sockSpec is mapped to alias.
    expect(state.added.size).toBe(0)
  })

  it('adds override when origPkgName matches via lsStdoutIncludes (line 187-256)', async () => {
    // Use prod=true to take the lsStdoutIncludes path (isLockScanned=false).
    const depObj = {}
    const overridesObj: Record<string, string> = {}
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', depObj]]),
      getMajor: vi.fn(() => 1),
      lsStdoutIncludes: vi.fn(() => true),
      getOverridesDataNpm: vi.fn(() => ({
        overrides: overridesObj,
        type: 'npm',
      })),
      getOverridesDataYarnClassic: vi.fn(() => ({
        overrides: {},
        type: 'yarn',
      })),
      listPackages: vi.fn(async () => ''),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
      prod: true,
    })
    expect(state.added.has('pkg-a')).toBe(true)
    expect(overridesObj['pkg-a-orig']).toMatch(/^npm:pkg-a@/)
  })

  it('updates an existing override (line 250 — addedOrUpdated branch)', async () => {
    // overrides already has the orig pkg key, so addedOrUpdated='updated'.
    const overridesObj: Record<string, string> = {
      'pkg-a-orig': '^0.9.0', // existing, doesn't start with `$` or sockOverridePrefix.
    }
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', {}]]),
      getMajor: vi.fn(() => 1),
      getOverridesDataNpm: vi.fn(() => ({
        overrides: overridesObj,
        type: 'npm',
      })),
      getOverridesDataYarnClassic: vi.fn(() => ({
        overrides: {},
        type: 'yarn',
      })),
      lsStdoutIncludes: vi.fn(() => true),
      listPackages: vi.fn(async () => ''),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
      prod: true,
    })
    // Since oldSpec='^0.9.0' doesn't start with `$` or sockOverridePrefix,
    // newSpec is set to oldSpec (line 245), so newSpec === oldSpec — no update.
    expect(state.updated.has('pkg-a')).toBe(false)
  })

  it('uses $-reference newSpec when type=NPM and depAlias exists (line 199-207)', async () => {
    // overrides[orig] exists AND deps include orig — so depAlias is set,
    // type === NPM triggers the $-reference branch.
    const overridesObj: Record<string, string> = {
      'pkg-a-orig': '^0.9.0',
    }
    const depObj = { 'pkg-a-orig': '^1.0.0' }
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', depObj]]),
      getMajor: vi.fn(() => 1),
      getOverridesDataNpm: vi.fn(() => ({
        overrides: overridesObj,
        type: 'npm',
      })),
      getOverridesDataYarnClassic: vi.fn(() => ({
        overrides: {},
        type: 'yarn',
      })),
      lsStdoutIncludes: vi.fn(() => true),
      listPackages: vi.fn(async () => ''),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
      prod: true,
    })
    // depAlias is present, type=NPM → newSpec set to `$pkg-a-orig`
    expect(overridesObj['pkg-a-orig']).toMatch(/^\$/)
    expect(state.updated.has('pkg-a')).toBe(true)
  })

  it('aggregates state from recursive workspace calls (line 295)', async () => {
    // Simulates a workspace setup. Both the outer (root) and inner (workspace
    // pkg) calls iterate the same shared deps object that contains pkg-a-orig,
    // so both add pkg-a. The inner call returns its state and line 295 merges
    // it into the outer state.
    const sharedDep = { 'pkg-a-orig': '^1.0.0' }
    let callCount = 0
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      // First call (outer/root): returns workspace pkg path. Second (inner): [].
      globWorkspace: vi.fn(async () => {
        callCount += 1
        if (callCount === 1) {
          return ['/test/project/packages/inner/package.json']
        }
        return []
      }),
      getDependencyEntries: vi.fn(() => [['dependencies', sharedDep]]),
      getMajor: vi.fn(() => 1),
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
    })
    // pkg-a was added by the inner workspace call (isWorkspaceRoot=false), so
    // it appears in state.addedInWorkspaces — that propagates via line 295.
    expect(state.added.has('pkg-a')).toBe(true)
    expect(state.addedInWorkspaces.has('packages/inner')).toBe(true)
  })

  it('with pin=true, fetches manifest when getMajor of existing spec mismatches (lines 213-242)', async () => {
    // Setup: overrides[orig] = 'npm:pkg-a@1.5.0' (sock-prefix). pin=true forces
    // re-validation by parsing/coercing — getMajor of 1.5.0 is 1, but we
    // mock it to return 99 so the inner if (getMajor !== major) fires,
    // triggering fetchPackageManifest.
    const overridesObj: Record<string, string> = {
      'pkg-a-orig': 'npm:pkg-a@1.5.0',
    }
    let getMajorCall = 0
    const fetchPackageManifest = vi.fn(async () => ({ version: '2.0.0' }))
    const addOverrides = await loadAddOverrides({
      manifestEntries: [
        ['pkg-a', { name: 'pkg-a', package: 'pkg-a-orig', version: '1.2.3' }],
      ],
      getDependencyEntries: vi.fn(() => [['dependencies', {}]]),
      // getMajor sequence:
      //   call 1: outer for the manifest entry version → 1
      //   call 2: inner IIFE for thisSpec parsed → 99 (mismatch!)
      //   call 3: outer otherMajor for fetched version → 2
      getMajor: vi.fn(() => {
        getMajorCall += 1
        if (getMajorCall === 1) {
          return 1
        }
        if (getMajorCall === 2) {
          return 99
        }
        return 2
      }),
      safeNpa: vi.fn(() => ({
        type: 'alias',
        subSpec: { rawSpec: '1.5.0' },
      })),
      getOverridesDataNpm: vi.fn(() => ({
        overrides: overridesObj,
        type: 'npm',
      })),
      getOverridesDataYarnClassic: vi.fn(() => ({
        overrides: {},
        type: 'yarn',
      })),
      lsStdoutIncludes: vi.fn(() => true),
      listPackages: vi.fn(async () => ''),
      fetchPackageManifest,
    })
    const env = baseEnv()
    const state = await addOverrides(env as unknown, '/test/project', {
      logger: mockLogger as unknown,
      prod: true,
      pin: true,
    })
    // fetchPackageManifest was invoked because the major mismatched.
    expect(fetchPackageManifest).toHaveBeenCalled()
    // newSpec was rewritten to use the fetched version.
    expect(overridesObj['pkg-a-orig']).toContain('npm:pkg-a@2.0.0')
    expect(state.updated.has('pkg-a')).toBe(true)
  })
})
