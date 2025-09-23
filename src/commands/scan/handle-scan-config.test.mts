import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleScanConfig } from './handle-scan-config.mts'

// Mock the dependencies.
vi.mock('./output-scan-config-result.mts', () => ({
  outputScanConfigResult: vi.fn(),
}))

vi.mock('./setup-scan-config.mts', () => ({
  setupScanConfig: vi.fn(),
}))

describe('handleScanConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets up scan config and outputs result', async () => {
    const { setupScanConfig } = await import('./setup-scan-config.mts')
    const { outputScanConfigResult } = await import(
      './output-scan-config-result.mts'
    )
    const mockSetup = vi.mocked(setupScanConfig)
    const mockOutput = vi.mocked(outputScanConfigResult)

    const mockResult = {
      ok: true,
      data: {
        config: {
          excludePatterns: ['node_modules/**', 'dist/**'],
          includePatterns: ['src/**'],
          scanLevel: 'high',
        },
      },
    }
    mockSetup.mockResolvedValue(mockResult)

    await handleScanConfig('/project', false)

    expect(mockSetup).toHaveBeenCalledWith('/project', false)
    expect(mockOutput).toHaveBeenCalledWith(mockResult)
  })

  it('uses defaultOnReadError when true', async () => {
    const { setupScanConfig } = await import('./setup-scan-config.mts')
    const { outputScanConfigResult } = await import(
      './output-scan-config-result.mts'
    )
    const mockSetup = vi.mocked(setupScanConfig)
    const mockOutput = vi.mocked(outputScanConfigResult)

    mockSetup.mockResolvedValue({ ok: true, data: {} })

    await handleScanConfig('/another/path', true)

    expect(mockSetup).toHaveBeenCalledWith('/another/path', true)
    expect(mockOutput).toHaveBeenCalled()
  })

  it('handles setup failure', async () => {
    const { setupScanConfig } = await import('./setup-scan-config.mts')
    const { outputScanConfigResult } = await import(
      './output-scan-config-result.mts'
    )
    const mockSetup = vi.mocked(setupScanConfig)
    const mockOutput = vi.mocked(outputScanConfigResult)

    const mockError = {
      ok: false,
      error: 'Configuration file not found',
    }
    mockSetup.mockResolvedValue(mockError)

    await handleScanConfig('/nonexistent', false)

    expect(mockOutput).toHaveBeenCalledWith(mockError)
  })

  it('uses default value for defaultOnReadError when not provided', async () => {
    const { setupScanConfig } = await import('./setup-scan-config.mts')
    const mockSetup = vi.mocked(setupScanConfig)

    mockSetup.mockResolvedValue({ ok: true, data: {} })

    await handleScanConfig('/project')

    // When not provided, function uses default value of false.
    expect(mockSetup).toHaveBeenCalledWith('/project', false)
  })

  it('handles different working directories', async () => {
    const { setupScanConfig } = await import('./setup-scan-config.mts')
    const mockSetup = vi.mocked(setupScanConfig)

    const cwds = ['/root', '/home/user/project', './relative/path', '.']

    for (const cwd of cwds) {
      mockSetup.mockResolvedValue({ ok: true, data: {} })
      // eslint-disable-next-line no-await-in-loop
      await handleScanConfig(cwd, false)
      expect(mockSetup).toHaveBeenCalledWith(cwd, false)
    }
  })
})
