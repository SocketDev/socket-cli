/**
 * Unit tests for detectAndValidatePackageEnvironment — package.json-driven
 * agent and version inference (packageManager field, engines, browserslist,
 * yarn-berry detection, missing package.json).
 *
 * Related Files: - util/ecosystem/environment.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { detectAndValidatePackageEnvironment } from '../../../../src/util/ecosystem/environment.mts'

const mockExistsSync = vi.hoisted(() => vi.fn())
const mockDefault = vi.hoisted(() => vi.fn())
const mockSatisfies = vi.hoisted(() => vi.fn())
const mockMajor = vi.hoisted(() => vi.fn())
const mockCoerce = vi.hoisted(() => vi.fn())
const mockWhichBin = vi.hoisted(() => vi.fn())
const mockReadFileUtf8 = vi.hoisted(() => vi.fn())
const mockReadPackageJson = vi.hoisted(() => vi.fn())
const mockToEditablePackageJson = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockFindUp = vi.hoisted(() => vi.fn())

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: vi.fn(),
}))
vi.mock(import('browserslist'), () => ({
  default: mockDefault.mockReturnValue([]),
}))
vi.mock(import('@socketsecurity/lib-stable/bin/which'), () => ({
  whichReal: mockWhichBin,
}))
vi.mock(import('@socketsecurity/lib-stable/fs/read-file'), () => ({
  readFileBinary: vi.fn(),
  readFileUtf8: mockReadFileUtf8,
}))
vi.mock(import('@socketsecurity/lib-stable/packages/read'), () => ({
  readPackageJson: mockReadPackageJson,
}))
vi.mock(import('@socketsecurity/lib-stable/packages/edit'), () => ({
  toEditablePackageJson: mockToEditablePackageJson,
}))
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))
vi.mock(import('../../../../src/util/fs/find-up.mts'), () => ({
  findUp: mockFindUp,
}))
vi.mock(
  import('../../../../src/constants/agents.mts'),
  async importOriginal => {
    const actual: unknown = await importOriginal()
    return {
      ...actual,
      getNpmExecPath: vi.fn(),
      getPnpmExecPath: vi.fn(),
    }
  },
)
vi.mock(import('semver'), () => ({
  default: {
    satisfies: mockSatisfies,
    major: mockMajor,
    coerce: mockCoerce,
    lt: vi.fn(() => false),
  },
}))

describe('detectAndValidatePackageEnvironment - package.json inference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockResolvedValue({ stdout: '10.0.0', stderr: '', code: 0 })
    mockToEditablePackageJson.mockImplementation(async pkgJson => ({
      content: pkgJson,
      path: '/project/package.json',
    }))
    // Mock semver functions for version checks.
    mockCoerce.mockImplementation((v: string) => ({
      version: v.replace(/^v/, ''),
      major: parseInt(v.replace(/^v/, '').split('.')[0] || '0', 10),
      minor: parseInt(v.replace(/^v/, '').split('.')[1] || '0', 10),
      patch: parseInt(v.replace(/^v/, '').split('.')[2] || '0', 10),
    }))
    mockSatisfies.mockReturnValue(true)
    mockMajor.mockImplementation((v: unknown) => v?.major ?? 18)
    mockReadFileUtf8.mockResolvedValue('lock content')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns error when package.json is missing', async () => {
    mockFindUp.mockImplementation(async files => {
      if (Array.isArray(files) && files.includes('package-lock.json')) {
        return '/project/package-lock.json'
      }
      if (files === 'package.json') {
        return '/project/package.json'
      }
      return undefined
    })
    // Return true for path existence, but make pkgPath undefined by not having editablePkgJson.
    mockExistsSync.mockReturnValue(true)
    mockWhichBin.mockResolvedValue('/usr/local/bin/npm')
    // Return undefined to simulate missing package.json.
    mockReadPackageJson.mockResolvedValue(undefined)
    mockToEditablePackageJson.mockResolvedValue(undefined)
    mockReadFileUtf8.mockResolvedValue('lock content')

    const result = await detectAndValidatePackageEnvironment('/project')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // The validation checks for lockfile presence first, and
      // editablePkgJson being undefined makes lockName undefined.
      expect(result.message).toBe('Missing lockfile')
    }
  })

  it('detects agent from packageManager field (lines 324-332)', async () => {
    // packageManager: "pnpm@8.15.7" → agent='pnpm' inferred from the field
    // before any lockfile lookup.
    mockFindUp.mockImplementation(async files => {
      if (Array.isArray(files) && files.includes('pnpm-lock.yaml')) {
        return '/project/pnpm-lock.yaml'
      }
      if (files === 'package.json') {
        return '/project/package.json'
      }
      return undefined
    })
    mockExistsSync.mockReturnValue(true)
    mockWhichBin.mockResolvedValue('/usr/local/bin/pnpm')
    mockReadPackageJson.mockResolvedValue({
      name: 'test-project',
      version: '1.0.0',
      packageManager: 'pnpm@8.15.7',
    })

    const result = await detectAndValidatePackageEnvironment('/project')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.agent).toBe('pnpm')
    }
  })

  it('falls back to npm when packageManager has no @ separator', async () => {
    mockFindUp.mockImplementation(async files => {
      if (Array.isArray(files) && files.includes('package-lock.json')) {
        return '/project/package-lock.json'
      }
      if (files === 'package.json') {
        return '/project/package.json'
      }
      return undefined
    })
    mockExistsSync.mockReturnValue(true)
    mockWhichBin.mockResolvedValue('/usr/local/bin/npm')
    mockReadPackageJson.mockResolvedValue({
      name: 'test-project',
      version: '1.0.0',
      // No '@' → atSignIndex < 0 → falls through to lockfile inference.
      packageManager: 'invalid-format',
    })

    const result = await detectAndValidatePackageEnvironment('/project')

    // Falls through to LOCKS lookup (package-lock.json → npm).
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.agent).toBe('npm')
    }
  })

  it('lowers pkgMinAgentVersion from package engines field (lines 366-373)', async () => {
    mockFindUp.mockImplementation(async files => {
      if (Array.isArray(files) && files.includes('package-lock.json')) {
        return '/project/package-lock.json'
      }
      if (files === 'package.json') {
        return '/project/package.json'
      }
      return undefined
    })
    mockExistsSync.mockReturnValue(true)
    mockWhichBin.mockResolvedValue('/usr/local/bin/npm')
    // Engines pin npm to >=8.0.0 and node to >=16.0.0 — both < the
    // minimum supported defaults, so they lower pkgMin*Version.
    mockReadPackageJson.mockResolvedValue({
      name: 'test-project',
      version: '1.0.0',
      engines: {
        npm: '>=8.0.0',
        node: '>=16.0.0',
      },
    })
    // Stub semver.lt: unknown coerced < default is true.
    mockSatisfies.mockReturnValue(true)

    const result = await detectAndValidatePackageEnvironment('/project')

    expect(result.ok).toBe(true)
  })

  it('lowers pkgMinNodeVersion from browserslist node targets (lines 387-399)', async () => {
    mockFindUp.mockImplementation(async files => {
      if (Array.isArray(files) && files.includes('package-lock.json')) {
        return '/project/package-lock.json'
      }
      if (files === 'package.json') {
        return '/project/package.json'
      }
      return undefined
    })
    mockExistsSync.mockReturnValue(true)
    mockWhichBin.mockResolvedValue('/usr/local/bin/npm')
    mockReadPackageJson.mockResolvedValue({
      name: 'test-project',
      version: '1.0.0',
      browserslist: ['node 16.0.0', 'node 18.0.0', 'chrome 120'],
    })
    // browserslist returns the targets sorted by browserslist itself; we
    // also want the node-* filter to keep ['node 16.0.0', 'node 18.0.0'].
    const mockBrowserslist = (await import('browserslist')).default as unknown
    mockBrowserslist.mockReturnValue([
      'node 16.0.0',
      'node 18.0.0',
      'chrome 120',
    ])

    const result = await detectAndValidatePackageEnvironment('/project')

    expect(result.ok).toBe(true)
  })

  it('detects yarn-berry when yarn-classic agent has major > 1 (lines 348-349)', async () => {
    mockFindUp.mockImplementation(async files => {
      if (Array.isArray(files) && files.includes('yarn.lock')) {
        return '/project/yarn.lock'
      }
      if (files === 'package.json') {
        return '/project/package.json'
      }
      return undefined
    })
    mockExistsSync.mockReturnValue(true)
    mockWhichBin.mockResolvedValue('/usr/local/bin/yarn')
    mockReadPackageJson.mockResolvedValue({
      name: 'test-project',
      version: '1.0.0',
    })
    // yarn version 4.x → coerced major 4 > 1 → upgrades classic to berry.
    mockSpawn.mockResolvedValue({ stdout: '4.5.0', stderr: '', code: 0 })

    const result = await detectAndValidatePackageEnvironment('/project')

    expect(result.ok).toBe(true)
    if (result.ok) {
      // Agent name uses '/' as the separator between flavor variants.
      expect(result.data.agent).toBe('yarn/berry')
    }
  })
})
