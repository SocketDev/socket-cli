/**
 * Unit tests for handleScanConfig.
 *
 * Purpose:
 * Tests the handler that manages scan configuration. Validates config file handling and option processing.
 *
 * Test Coverage:
 * - Successful operation flow
 * - Fetch failure handling
 * - Input validation
 * - Output formatting delegation
 * - Error propagation
 *
 * Testing Approach:
 * Mocks fetch and output functions to isolate handler orchestration logic.
 * Validates proper data flow through the handler pipeline.
 *
 * Related Files:
 * - src/commands/handleScanConfig.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createErrorResult,
  createSuccessResult,
} from '../../../../../test/helpers/mocks.mts'
import { handleScanConfig } from '../../../../src/commands/scan/handle-scan-config.mts'

// Mock the dependencies.
const mockOutputScanConfigResult = vi.hoisted(() => vi.fn())
const mockSetupScanConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/output-scan-config-result.mts', () => ({
  outputScanConfigResult: mockOutputScanConfigResult,
}))

vi.mock('../../../../src/commands/scan/setup-scan-config.mts', () => ({
  setupScanConfig: mockSetupScanConfig,
}))

describe('handleScanConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets up scan config and outputs result', async () => {
      './output-scan-config-result.mts'
    const mockSetup = mockSetupScanConfig
    const mockOutput = mockOutputScanConfigResult

    const mockResult = createSuccessResult({
      config: {
        excludePatterns: ['node_modules/**', 'dist/**'],
        includePatterns: ['src/**'],
        scanLevel: 'high',
      },
    })
    mockSetup.mockResolvedValue(mockResult)

    await handleScanConfig('/project', false)

    expect(mockSetup).toHaveBeenCalledWith('/project', false)
    expect(mockOutput).toHaveBeenCalledWith(mockResult)
  })

  it('uses defaultOnReadError when true', async () => {
      './output-scan-config-result.mts'
    const mockSetup = mockSetupScanConfig
    const mockOutput = mockOutputScanConfigResult

    mockSetup.mockResolvedValue(createSuccessResult({}))

    await handleScanConfig('/another/path', true)

    expect(mockSetup).toHaveBeenCalledWith('/another/path', true)
    expect(mockOutput).toHaveBeenCalled()
  })

  it('handles setup failure', async () => {
      './output-scan-config-result.mts'
    const mockSetup = mockSetupScanConfig
    const mockOutput = mockOutputScanConfigResult

    const mockError = createErrorResult('Configuration file not found')
    mockSetup.mockResolvedValue(mockError)

    await handleScanConfig('/nonexistent', false)

    expect(mockOutput).toHaveBeenCalledWith(mockError)
  })

  it('uses default value for defaultOnReadError when not provided', async () => {
    const mockSetup = mockSetupScanConfig

    mockSetup.mockResolvedValue(createSuccessResult({}))

    await handleScanConfig('/project')

    // When not provided, function uses default value of false.
    expect(mockSetup).toHaveBeenCalledWith('/project', false)
  })

  it('handles different working directories', async () => {
    const mockSetup = mockSetupScanConfig

    const cwds = ['/root', '/home/user/project', './relative/path', '.']

    for (const cwd of cwds) {
      mockSetup.mockResolvedValue(createSuccessResult({}))
      // eslint-disable-next-line no-await-in-loop
      await handleScanConfig(cwd, false)
      expect(mockSetup).toHaveBeenCalledWith(cwd, false)
    }
  })
})
