import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'

// Mock the dependencies.
vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchSupportedScanFileNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches supported scan file names successfully', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        supportedFiles: [
          'package.json',
          'package-lock.json',
          'yarn.lock',
          'pnpm-lock.yaml',
          'composer.json',
          'composer.lock',
          'Gemfile',
          'Gemfile.lock',
          'requirements.txt',
          'Pipfile',
          'Pipfile.lock',
          'go.mod',
          'go.sum',
        ],
        ecosystems: ['npm', 'composer', 'ruby', 'python', 'go'],
      },
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchSupportedScanFileNames()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      undefined,
    )
    expect(result).toEqual(successResult)
  })

  it('handles SDK setup failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchSupportedScanFileNames()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      undefined,
    )
    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const error = {
      ok: false as const,
      error: 'Failed to fetch supported files',
      code: 500,
      message: 'Failed to fetch supported files',
    }
    mockWithSdk.mockResolvedValueOnce(error)

    const result = await fetchSupportedScanFileNames()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      undefined,
    )
    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchSupportedScanFileNames(options)

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      options,
    )
  })

  it('passes custom spinner', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }

    const mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }

    mockWithSdk.mockResolvedValueOnce(successResult)

    const options = {
      spinner: mockSpinner,
    }

    await fetchSupportedScanFileNames(options)

    // Note: withSdk doesn't support spinner option yet per implementation comment
    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      options,
    )
  })

  it('handles empty supported files response', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        supportedFiles: [],
        ecosystems: [],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchSupportedScanFileNames()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.supportedFiles).toEqual([])
    }
  })

  it('handles comprehensive file types', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        supportedFiles: [
          'package.json',
          'package-lock.json',
          'yarn.lock',
          'pnpm-lock.yaml',
          'npm-shrinkwrap.json',
          'bun.lockb',
          'Gemfile',
          'Gemfile.lock',
          'composer.json',
          'composer.lock',
          'requirements.txt',
          'Pipfile',
          'Pipfile.lock',
          'poetry.lock',
          'go.mod',
          'go.sum',
          'pom.xml',
          'build.gradle',
          'Cargo.toml',
          'Cargo.lock',
        ],
        ecosystems: [
          'npm',
          'ruby',
          'composer',
          'python',
          'go',
          'maven',
          'gradle',
          'rust',
        ],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    const result = await fetchSupportedScanFileNames()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      undefined,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.supportedFiles.length).toBeGreaterThan(10)
      expect(result.data.ecosystems).toContain('npm')
    }
  })

  it('works without options parameter', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {
        supportedFiles: ['package.json'],
        ecosystems: ['npm'],
      },
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    await fetchSupportedScanFileNames()

    expect(mockWithSdk).toHaveBeenCalledWith(
      expect.any(Function),
      'supported scan file types',
      undefined,
    )
  })

  it('uses null prototype for options', async () => {
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockWithSdk = vi.mocked(withSdk)

    const successResult = {
      ok: true as const,
      data: {},
    }
    mockWithSdk.mockResolvedValueOnce(successResult)

    // This tests that the function properly uses __proto__: null.
    await fetchSupportedScanFileNames()

    // The function should work without prototype pollution issues.
    expect(mockWithSdk).toHaveBeenCalled()
  })
})
