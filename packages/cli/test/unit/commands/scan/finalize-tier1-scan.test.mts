/**
 * Unit tests for tier1 scan finalization.
 *
 * Purpose:
 * Tests the finalizeTier1Scan function for completing reachability scans.
 *
 * Test Coverage:
 * - API request formatting
 * - Parameter passing
 *
 * Related Files:
 * - commands/scan/finalize-tier1-scan.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockSendApiRequest = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/socket/api.mjs', () => ({
  sendApiRequest: mockSendApiRequest,
}))

import { finalizeTier1Scan } from '../../../../src/commands/scan/finalize-tier1-scan.mts'

describe('finalize-tier1-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('finalizeTier1Scan', () => {
    it('sends API request with correct endpoint and body', async () => {
      mockSendApiRequest.mockResolvedValue({ ok: true, data: {} })

      await finalizeTier1Scan('tier1-scan-id-123', 'scan-id-456')

      expect(mockSendApiRequest).toHaveBeenCalledTimes(1)
      expect(mockSendApiRequest).toHaveBeenCalledWith(
        'tier1-reachability-scan/finalize',
        {
          method: 'POST',
          body: {
            tier1_reachability_scan_id: 'tier1-scan-id-123',
            report_run_id: 'scan-id-456',
          },
        },
      )
    })

    it('returns success result from API', async () => {
      const mockResult = { ok: true, data: { status: 'finalized' } }
      mockSendApiRequest.mockResolvedValue(mockResult)

      const result = await finalizeTier1Scan('tier1-id', 'scan-id')

      expect(result).toEqual(mockResult)
    })

    it('returns error result from API', async () => {
      const mockResult = { ok: false, message: 'API error', cause: 'Not found' }
      mockSendApiRequest.mockResolvedValue(mockResult)

      const result = await finalizeTier1Scan('tier1-id', 'scan-id')

      expect(result).toEqual(mockResult)
    })
  })
})
