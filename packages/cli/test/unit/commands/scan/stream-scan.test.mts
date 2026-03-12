/**
 * Unit tests for stream scan functionality.
 *
 * Purpose:
 * Tests the scan streaming to file/stdout.
 *
 * Test Coverage:
 * - streamScan function
 * - SDK setup handling
 * - API call handling
 * - File output options
 *
 * Related Files:
 * - src/commands/scan/stream-scan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock SDK setup.
const mockSetupSdk = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  setupSdk: mockSetupSdk,
}))

// Mock API handler.
const mockHandleApiCall = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/socket/api.mjs', () => ({
  handleApiCall: mockHandleApiCall,
}))

import { streamScan } from '../../../../src/commands/scan/stream-scan.mts'

describe('stream-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('streamScan', () => {
    const mockStreamFullScan = vi.fn()
    const mockSdk = {
      streamFullScan: mockStreamFullScan,
    }

    it('returns error when SDK setup fails', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: false,
        message: 'Invalid API token',
      })

      const result = await streamScan('my-org', 'scan-123')

      expect(result).toEqual({
        ok: false,
        message: 'Invalid API token',
      })
      expect(mockHandleApiCall).not.toHaveBeenCalled()
    })

    it('streams scan data successfully', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: true }))
      mockHandleApiCall.mockResolvedValue({ ok: true, data: {} })

      const result = await streamScan('my-org', 'scan-123')

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Requesting data from API...',
      )
      expect(mockStreamFullScan).toHaveBeenCalledWith('my-org', 'scan-123', {
        output: undefined,
      })
      expect(result).toEqual({ ok: true, data: {} })
    })

    it('passes file option for output', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: true }))
      mockHandleApiCall.mockResolvedValue({ ok: true, data: {} })

      await streamScan('my-org', 'scan-123', { file: '/output.json' })

      expect(mockStreamFullScan).toHaveBeenCalledWith('my-org', 'scan-123', {
        output: '/output.json',
      })
    })

    it('uses stdout when file is dash', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: true }))
      mockHandleApiCall.mockResolvedValue({ ok: true, data: {} })

      await streamScan('my-org', 'scan-123', { file: '-' })

      expect(mockStreamFullScan).toHaveBeenCalledWith('my-org', 'scan-123', {
        output: undefined,
      })
    })

    it('passes command path to API handler', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: true }))
      mockHandleApiCall.mockResolvedValue({ ok: true, data: {} })

      await streamScan('my-org', 'scan-123', { commandPath: 'scan stream' })

      expect(mockHandleApiCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          commandPath: 'scan stream',
          description: 'a scan',
        }),
      )
    })

    it('passes SDK options', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: true }))
      mockHandleApiCall.mockResolvedValue({ ok: true, data: {} })

      await streamScan('my-org', 'scan-123', {
        sdkOpts: { apiToken: 'custom-token' },
      })

      expect(mockSetupSdk).toHaveBeenCalledWith({ apiToken: 'custom-token' })
    })

    it('handles API call failure', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: false }))
      mockHandleApiCall.mockResolvedValue({
        ok: false,
        message: 'Scan not found',
      })

      const result = await streamScan('my-org', 'scan-123')

      expect(result).toEqual({
        ok: false,
        message: 'Scan not found',
      })
    })

    it('works with no options', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: true,
        data: mockSdk,
      })
      mockStreamFullScan.mockReturnValue(Promise.resolve({ ok: true }))
      mockHandleApiCall.mockResolvedValue({ ok: true, data: {} })

      const result = await streamScan('my-org', 'scan-123')

      expect(mockSetupSdk).toHaveBeenCalledWith(undefined)
      expect(result.ok).toBe(true)
    })
  })
})
