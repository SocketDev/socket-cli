import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENTS, detectPackageEnvironment } from './package-environment.mts'

// Mock the dependencies.
vi.mock('node:fs', async importOriginal => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    existsSync: vi.fn(),
  }
})

vi.mock('browserslist', () => ({
  default: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/bin', () => ({
  whichBin: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/fs', () => ({
  readFileBinary: vi.fn(),
  readFileUtf8: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/packages', () => ({
  readPackageJson: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

vi.mock('./fs.mts', () => ({
  findUp: vi.fn(),
}))

vi.mock('../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as any
  const kInternalsSymbol = Symbol.for('kInternalsSymbol')
  return {
    ...actual,
    default: {
      ...actual.default,
      kInternalsSymbol,
      [kInternalsSymbol]: {
        getSentry: vi.fn(() => undefined),
      },
    },
  }
})

describe('package-environment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('AGENTS', () => {
    it('contains all expected package managers', () => {
      expect(AGENTS).toContain('npm')
      expect(AGENTS).toContain('pnpm')
      expect(AGENTS).toContain('bun')
      expect(AGENTS).toContain('vlt')
      expect(AGENTS.length).toBeGreaterThan(0)
    })
  })

  describe('detectPackageEnvironment', () => {
    it('detects npm environment with package-lock.json', async () => {
      const { existsSync } = await import('node:fs')
      const { readPackageJson } = await import(
        '@socketsecurity/registry/lib/packages'
      )
      const { findUp } = await import('./fs.mts')
      const { whichBin } = await import('@socketsecurity/registry/lib/bin')
      const mockExistsSync = vi.mocked(existsSync)
      const mockReadPackageJson = vi.mocked(readPackageJson)
      const mockFindUp = vi.mocked(findUp)
      const mockWhichBin = vi.mocked(whichBin)

      mockFindUp.mockResolvedValue('/project/package.json')
      mockExistsSync.mockImplementation(path => {
        if (String(path).includes('package-lock.json')) {
          return true
        }
        return false
      })
      mockReadPackageJson.mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
      })
      mockWhichBin.mockResolvedValue('/usr/local/bin/npm')

      const result = await detectPackageEnvironment({ cwd: '/project' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.agent).toBe('npm')
        expect(result.data.lockfiles).toContain('package-lock.json')
      }
    })

    it('detects pnpm environment with pnpm-lock.yaml', async () => {
      const { existsSync } = await import('node:fs')
      const { readPackageJson } = await import(
        '@socketsecurity/registry/lib/packages'
      )
      const { findUp } = await import('./fs.mts')
      const { whichBin } = await import('@socketsecurity/registry/lib/bin')
      const mockExistsSync = vi.mocked(existsSync)
      const mockReadPackageJson = vi.mocked(readPackageJson)
      const mockFindUp = vi.mocked(findUp)
      const mockWhichBin = vi.mocked(whichBin)

      mockFindUp.mockResolvedValue('/project/package.json')
      mockExistsSync.mockImplementation(path => {
        if (String(path).includes('pnpm-lock.yaml')) {
          return true
        }
        return false
      })
      mockReadPackageJson.mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
      })
      mockWhichBin.mockResolvedValue('/usr/local/bin/pnpm')

      const result = await detectPackageEnvironment({ cwd: '/project' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.agent).toBe('pnpm')
        expect(result.data.lockfiles).toContain('pnpm-lock.yaml')
      }
    })

    it('detects yarn environment with yarn.lock', async () => {
      const { existsSync } = await import('node:fs')
      const { readPackageJson } = await import(
        '@socketsecurity/registry/lib/packages'
      )
      const { findUp } = await import('./fs.mts')
      const { whichBin } = await import('@socketsecurity/registry/lib/bin')
      const mockExistsSync = vi.mocked(existsSync)
      const mockReadPackageJson = vi.mocked(readPackageJson)
      const mockFindUp = vi.mocked(findUp)
      const mockWhichBin = vi.mocked(whichBin)

      mockFindUp.mockResolvedValue('/project/package.json')
      mockExistsSync.mockImplementation(path => {
        if (String(path).includes('yarn.lock')) {
          return true
        }
        return false
      })
      mockReadPackageJson.mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
      })
      mockWhichBin.mockResolvedValue('/usr/local/bin/yarn')

      const result = await detectPackageEnvironment({ cwd: '/project' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.agent?.startsWith('yarn')).toBe(true)
        expect(result.data.lockfiles).toContain('yarn.lock')
      }
    })

    it('detects bun environment with bun.lockb', async () => {
      const { existsSync } = await import('node:fs')
      const { readPackageJson } = await import(
        '@socketsecurity/registry/lib/packages'
      )
      const { findUp } = await import('./fs.mts')
      const { whichBin } = await import('@socketsecurity/registry/lib/bin')
      const mockExistsSync = vi.mocked(existsSync)
      const mockReadPackageJson = vi.mocked(readPackageJson)
      const mockFindUp = vi.mocked(findUp)
      const mockWhichBin = vi.mocked(whichBin)

      mockFindUp.mockResolvedValue('/project/package.json')
      mockExistsSync.mockImplementation(path => {
        if (String(path).includes('bun.lockb')) {
          return true
        }
        return false
      })
      mockReadPackageJson.mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
      })
      mockWhichBin.mockResolvedValue('/usr/local/bin/bun')

      const result = await detectPackageEnvironment({ cwd: '/project' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.agent).toBe('bun')
        expect(result.data.lockfiles).toContain('bun.lockb')
      }
    })

    it('returns error when no package.json found', async () => {
      const { findUp } = await import('./fs.mts')
      const mockFindUp = vi.mocked(findUp)

      mockFindUp.mockResolvedValue(undefined)

      const result = await detectPackageEnvironment({ cwd: '/nonexistent' })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe(1)
      }
    })

    it('handles workspaces configuration', async () => {
      const { existsSync } = await import('node:fs')
      const { readPackageJson } = await import(
        '@socketsecurity/registry/lib/packages'
      )
      const { findUp } = await import('./fs.mts')
      const mockExistsSync = vi.mocked(existsSync)
      const mockReadPackageJson = vi.mocked(readPackageJson)
      const mockFindUp = vi.mocked(findUp)

      mockFindUp.mockResolvedValue('/project/package.json')
      mockExistsSync.mockReturnValue(true)
      mockReadPackageJson.mockResolvedValue({
        name: 'monorepo-root',
        version: '1.0.0',
        workspaces: ['packages/*'],
      })

      const result = await detectPackageEnvironment({ cwd: '/project' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.packageJson?.workspaces).toEqual(['packages/*'])
      }
    })

    it('detects browserslist configuration', async () => {
      const { existsSync } = await import('node:fs')
      const { readPackageJson } = await import(
        '@socketsecurity/registry/lib/packages'
      )
      const { findUp } = await import('./fs.mts')
      const browserslist = await import('browserslist')
      const mockExistsSync = vi.mocked(existsSync)
      const mockReadPackageJson = vi.mocked(readPackageJson)
      const mockFindUp = vi.mocked(findUp)
      const mockBrowserslist = vi.mocked(browserslist.default)

      mockFindUp.mockResolvedValue('/project/package.json')
      mockExistsSync.mockReturnValue(false)
      mockReadPackageJson.mockResolvedValue({
        name: 'test-project',
        version: '1.0.0',
        browserslist: ['> 1%', 'last 2 versions'],
      })
      mockBrowserslist.mockReturnValue(['chrome 100', 'firefox 99'])

      const result = await detectPackageEnvironment({ cwd: '/project' })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.browsers).toBeTruthy()
      }
    })
  })
})
