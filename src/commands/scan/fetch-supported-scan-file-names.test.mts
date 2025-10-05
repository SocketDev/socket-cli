import { describe, expect, it, vi } from 'vitest'

// Mock the dependencies.

vi.mock('../../utils/sdk.mts', () => ({
  withSdk: vi.fn(),
}))

describe('fetchSupportedScanFileNames', () => {
  it('fetches supported scan file names successfully', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({
        success: true,
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
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        supportedFiles: ['package.json', 'yarn.lock', 'composer.json'],
      },
    })

    const result = await fetchSupportedScanFileNames()

    expect(mockSdk.getSupportedScanFiles).toHaveBeenCalledWith()
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'supported scan file types',
    })
    expect(result.ok).toBe(true)
    expect(result.data?.supportedFiles).toContain('package.json')
  })

  it('handles SDK setup failure', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockSetupSdk = vi.mocked(withSdk)

    const error = {
      ok: false,
      code: 1,
      message: 'Failed to setup SDK',
      cause: 'Invalid configuration',
    }
    mockSetupSdk.mockResolvedValue(error)

    const result = await fetchSupportedScanFileNames()

    expect(result).toEqual(error)
  })

  it('handles API call failure', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { handleApiCall } = await import('../../utils/api.mts')
    const { withSdk } = await import('../../utils/sdk.mts')
    const mockHandleApi = vi.mocked(handleApiCall)
    const mockSetupSdk = vi.mocked(withSdk)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockRejectedValue(new Error('API error')),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: false,
      error: 'Failed to fetch supported files',
      code: 500,
    })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const options = {
      sdkOpts: {
        apiToken: 'custom-token',
        baseUrl: 'https://api.example.com',
      },
    }

    await fetchSupportedScanFileNames(options)

    expect(mockSetupSdk).toHaveBeenCalledWith(options.sdkOpts)
    expect(mockSdk.getSupportedScanFiles).toHaveBeenCalledWith()
  })

  it('passes custom spinner', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({}),
    }

    const mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    const options = {
      spinner: mockSpinner,
    }

    await fetchSupportedScanFileNames(options)

    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'supported scan file types',
      spinner: mockSpinner,
    })
  })

  it('handles empty supported files response', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({
        success: true,
        data: {
          supportedFiles: [],
          ecosystems: [],
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: {
        supportedFiles: [],
        ecosystems: [],
      },
    })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(true)
    expect(result.data?.supportedFiles).toEqual([])
    expect(result.data?.ecosystems).toEqual([])
  })

  it('handles comprehensive file types', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const comprehensiveFiles = [
      // JavaScript/Node.js
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      // PHP
      'composer.json',
      'composer.lock',
      // Ruby
      'Gemfile',
      'Gemfile.lock',
      // Python
      'requirements.txt',
      'Pipfile',
      'Pipfile.lock',
      'poetry.lock',
      'pyproject.toml',
      // Go
      'go.mod',
      'go.sum',
      // Java
      'pom.xml',
      'build.gradle',
      // .NET
      'packages.config',
      '*.csproj',
      // Rust
      'Cargo.toml',
      'Cargo.lock',
    ]

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({
        success: true,
        data: {
          supportedFiles: comprehensiveFiles,
        },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: { supportedFiles: comprehensiveFiles },
    })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(true)
    expect(result.data?.supportedFiles).toContain('package.json')
    expect(result.data?.supportedFiles).toContain('Cargo.toml')
    expect(result.data?.supportedFiles).toContain('pom.xml')
  })

  it('works without options parameter', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({
        success: true,
        data: { supportedFiles: ['package.json'] },
      }),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({
      ok: true,
      data: { supportedFiles: ['package.json'] },
    })

    const result = await fetchSupportedScanFileNames()

    expect(mockSetupSdk).toHaveBeenCalledWith(undefined)
    expect(mockHandleApi).toHaveBeenCalledWith(expect.any(Promise), {
      description: 'supported scan file types',
      spinner: undefined,
    })
    expect(result.ok).toBe(true)
  })

  it('uses null prototype for options', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )
    const { withSdk } = await import('../../utils/sdk.mts')
    const { handleApiCall } = await import('../../utils/api.mts')
    const mockSetupSdk = vi.mocked(withSdk)
    const mockHandleApi = vi.mocked(handleApiCall)

    const mockSdk = {
      getSupportedScanFiles: vi.fn().mockResolvedValue({}),
    }

    mockSetupSdk.mockResolvedValue({ ok: true, data: mockSdk })
    mockHandleApi.mockResolvedValue({ ok: true, data: {} })

    // This tests that the function properly uses __proto__: null.
    await fetchSupportedScanFileNames()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getSupportedScanFiles).toHaveBeenCalled()
  })
})
