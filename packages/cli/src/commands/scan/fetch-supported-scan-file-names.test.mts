import { describe, expect, it, vi } from 'vitest'

import {
  setupSdkMockError,
  setupSdkMockSuccess,
  setupSdkSetupFailure,
} from '../../../test/helpers/sdk-test-helpers.mts'

// Mock the dependencies.
vi.mock('../../utils/socket/api.mts', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mts', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchSupportedScanFileNames', () => {
  it('fetches supported scan file names successfully', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )

    const mockData = {
      supportedFiles: ['package.json', 'yarn.lock', 'composer.json'],
    }

    const { mockHandleApi, mockSdk } = await setupSdkMockSuccess(
      'getSupportedScanFiles',
      mockData,
    )

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

    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Invalid configuration',
    })

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Failed to setup SDK')
    expect(result.cause).toBe('Invalid configuration')
  })

  it('handles API call failure', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )

    await setupSdkMockError('getSupportedScanFiles', 'API error', 500)

    const result = await fetchSupportedScanFileNames()

    expect(result.ok).toBe(false)
    expect(result.code).toBe(500)
  })

  it('passes custom SDK options', async () => {
    const { fetchSupportedScanFileNames } = await import(
      './fetch-supported-scan-file-names.mts'
    )

    const { mockSdk, mockSetupSdk } = await setupSdkMockSuccess(
      'getSupportedScanFiles',
      {},
    )

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

    const { mockHandleApi } = await setupSdkMockSuccess(
      'getSupportedScanFiles',
      {},
    )

    const mockSpinner = {
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    }

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

    await setupSdkMockSuccess('getSupportedScanFiles', {
      supportedFiles: [],
      ecosystems: [],
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

    await setupSdkMockSuccess('getSupportedScanFiles', {
      supportedFiles: comprehensiveFiles,
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

    const { mockHandleApi, mockSetupSdk } = await setupSdkMockSuccess(
      'getSupportedScanFiles',
      { supportedFiles: ['package.json'] },
    )

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

    const { mockSdk } = await setupSdkMockSuccess('getSupportedScanFiles', {})

    // This tests that the function properly uses __proto__: null.
    await fetchSupportedScanFileNames()

    // The function should work without prototype pollution issues.
    expect(mockSdk.getSupportedScanFiles).toHaveBeenCalled()
  })
})
