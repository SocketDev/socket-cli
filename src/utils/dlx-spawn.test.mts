import { describe, expect, it, vi, beforeEach } from 'vitest'

import { spawnDlx } from './dlx.mts'

import type { DlxPackageSpec } from './dlx.mts'

// Mock dependencies.
vi.mock('node:module', async importOriginal => {
  const actual = await importOriginal<typeof import('node:module')>()

  // Create mocks inline to avoid hoisting issues.
  const shadowNpxMock = vi.fn().mockResolvedValue({
    spawnPromise: Promise.resolve({ stdout: 'npx output', stderr: '' }),
  })
  const shadowPnpmMock = vi.fn().mockResolvedValue({
    spawnPromise: Promise.resolve({ stdout: 'pnpm output', stderr: '' }),
  })
  const shadowYarnMock = vi.fn().mockResolvedValue({
    spawnPromise: Promise.resolve({ stdout: 'yarn output', stderr: '' }),
  })

  // Store in global for later access.
  ;(globalThis as any).__mockShadowNpx = shadowNpxMock
  ;(globalThis as any).__mockShadowPnpm = shadowPnpmMock
  ;(globalThis as any).__mockShadowYarn = shadowYarnMock

  return {
    ...actual,
    createRequire: vi.fn(() => {
      // Return a require function that returns the correct shadow bin mock.
      return vi.fn((path: string) => {
        if (path.includes('shadow-bin/npx')) {
          return shadowNpxMock
        }
        if (path.includes('shadow-bin/pnpm')) {
          return shadowPnpmMock
        }
        if (path.includes('shadow-bin/yarn')) {
          return shadowYarnMock
        }
        return vi.fn()
      })
    }),
  }
})

vi.mock('@socketsecurity/registry/lib/objects', () => ({
  getOwn: vi.fn((obj, key) => obj?.[key]),
}))

vi.mock('../commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: vi.fn(),
}))

vi.mock('./errors.mts', () => ({
  getErrorCause: vi.fn(error => error?.message || 'Unknown error'),
}))

vi.mock('./fs.mts', () => ({
  findUp: vi.fn(),
}))

vi.mock('./sdk.mts', () => ({
  getDefaultApiToken: vi.fn(),
  getDefaultProxyUrl: vi.fn(),
}))

vi.mock('./yarn-version.mts', () => ({
  isYarnBerry: vi.fn(() => false),
}))

vi.mock('./npm-paths.mts', () => ({
  getNpxBinPath: vi.fn(() => '/usr/bin/npx'),
}))

vi.mock('./pnpm-paths.mts', () => ({
  getPnpmBinPath: vi.fn(() => '/usr/bin/pnpm'),
}))

vi.mock('./yarn-paths.mts', () => ({
  getYarnBinPath: vi.fn(() => '/usr/bin/yarn'),
}))

describe('spawnDlx', () => {
  let mockShadowNpx: any
  let mockShadowPnpm: any
  let mockShadowYarn: any

  beforeEach(() => {
    vi.clearAllMocks()
    // Get mocks from global.
    mockShadowNpx = (globalThis as any).__mockShadowNpx
    mockShadowPnpm = (globalThis as any).__mockShadowPnpm
    mockShadowYarn = (globalThis as any).__mockShadowYarn
  })

  it('uses npm by default when no lockfile found', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockResolvedValue(undefined)

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
    }

    await spawnDlx(packageSpec, ['--help'])

    expect(mockShadowNpx).toHaveBeenCalledWith(
      ['--yes', '--silent', '--quiet', 'test-package', '--help'],
      {},
      undefined,
    )
  })

  it('uses pnpm dlx when pnpm-lock.yaml found', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockImplementation(async file => {
      if (file === 'pnpm-lock.yaml') {
        return '/project/pnpm-lock.yaml'
      }
      return undefined
    })

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
      version: '2.0.0',
    }

    await spawnDlx(packageSpec, ['--version'])

    expect(mockShadowPnpm).toHaveBeenCalledWith(
      ['dlx', 'test-package@2.0.0', '--version'], // No --silent for pinned version.
      {},
      undefined,
    )
  })

  it('uses yarn dlx for Yarn Berry', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockImplementation(async file => {
      if (file === 'yarn.lock') {
        return '/project/yarn.lock'
      }
      return undefined
    })

    const { isYarnBerry } = vi.mocked(await import('./yarn-version.mts'))
    isYarnBerry.mockReturnValue(true)

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
      version: '3.0.0',
    }

    await spawnDlx(packageSpec, ['run'])

    expect(mockShadowYarn).toHaveBeenCalledWith(
      ['dlx', 'test-package@3.0.0', 'run'], // No --quiet for pinned version.
      {},
      undefined,
    )
  })

  it('applies force flag for npm', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockResolvedValue(undefined)

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
      version: '1.0.0',
    }

    await spawnDlx(packageSpec, ['--help'], { force: true })

    expect(mockShadowNpx).toHaveBeenCalledWith(
      ['--yes', '--force', 'test-package@1.0.0', '--help'], // No --silent for pinned version.
      {},
      undefined,
    )
  })

  it('applies force flag for pnpm with cache settings', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockImplementation(async file => {
      if (file === 'pnpm-lock.yaml') {
        return '/project/pnpm-lock.yaml'
      }
      return undefined
    })

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
    }

    await spawnDlx(packageSpec, ['test'], { force: true })

    expect(mockShadowPnpm).toHaveBeenCalledWith(
      [
        'dlx',
        '--prefer-offline=false',
        '--package=test-package',
        '--silent',
        'test-package',
        'test',
      ],
      {},
      undefined,
    )
  })

  it('handles custom environment variables', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockResolvedValue(undefined)

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
    }

    const customEnv = { NODE_ENV: 'test', CUSTOM_VAR: 'value' }
    await spawnDlx(packageSpec, ['run'], { env: customEnv })

    expect(mockShadowNpx).toHaveBeenCalledWith(
      ['--yes', '--silent', '--quiet', 'test-package', 'run'],
      { env: customEnv },
      undefined,
    )
  })

  it('passes timeout option correctly', async () => {
    const { findUp } = vi.mocked(await import('./fs.mts'))
    findUp.mockResolvedValue(undefined)

    const packageSpec: DlxPackageSpec = {
      name: 'test-package',
    }

    await spawnDlx(packageSpec, ['test'], { timeout: 5000 })

    expect(mockShadowNpx).toHaveBeenCalledWith(
      ['--yes', '--silent', '--quiet', 'test-package', 'test'],
      { timeout: 5000 },
      undefined,
    )
  })
})
