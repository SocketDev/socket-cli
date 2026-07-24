/**
 * Unit tests for Telemetry service.
 *
 * Purpose: Tests concurrent client initialization, sendEvents error
 * handling, batch-size auto-flush, and flush/destroy timeout branches.
 *
 * Related Files: - util/telemetry/service.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tolerantSleep } from '../../../../../../test/fleet/_shared/lib/timing.mts'

// Mock setupSdk.
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetOrgTelemetryConfig = vi.hoisted(() => vi.fn())
const mockPostOrgTelemetry = vi.hoisted(() => vi.fn())

vi.mock(import('../../../../src/util/socket/sdk.mts'), () => ({
  setupSdk: mockSetupSdk,
}))

import { TelemetryService } from '../../../../src/util/telemetry/service.mts'

describe('TelemetryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockGetOrgTelemetryConfig.mockResolvedValue({
      success: true,
      data: {
        telemetry: {
          enabled: true,
        },
      },
    })

    mockPostOrgTelemetry.mockResolvedValue({
      success: true,
    })

    mockSetupSdk.mockResolvedValue({
      ok: true,
      data: {
        getOrgTelemetryConfig: mockGetOrgTelemetryConfig,
        postOrgTelemetry: mockPostOrgTelemetry,
      },
    })
  })

  afterEach(async () => {
    // Clean up singleton instance after each test.
    const instance = TelemetryService.getCurrentInstance()
    if (instance) {
      await instance.destroy()
    }
  })

  describe('concurrent initialization', () => {
    it('handles concurrent calls to getTelemetryClient', async () => {
      // Simulate concurrent calls.
      const [client1, client2, client3] = await Promise.all([
        TelemetryService.getTelemetryClient('test-org'),
        TelemetryService.getTelemetryClient('test-org'),
        TelemetryService.getTelemetryClient('test-org'),
      ])

      // All should return the same instance.
      expect(client1).toBe(client2)
      expect(client2).toBe(client3)

      // SDK setup should only be called once.
      expect(mockSetupSdk).toHaveBeenCalledTimes(1)
    })
  })

  describe('sendEvents error handling', () => {
    it('tracks success and failure counts correctly', async () => {
      // Make some events succeed and some fail.
      let callCount = 0
      mockPostOrgTelemetry.mockImplementation(async () => {
        callCount++
        if (callCount % 2 === 0) {
          return { success: false, error: 'Failed' }
        }
        return { success: true }
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'event_1',
        context: {},
      })
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'event_2',
        context: {},
      })
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'event_3',
        context: {},
      })

      await client.flush()

      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(3)
    })

    it('handles rejected promises during send', async () => {
      let callCount = 0
      mockPostOrgTelemetry.mockImplementation(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('Network error')
        }
        return { success: true }
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'event_1',
        context: {},
      })
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'event_2',
        context: {},
      })
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'event_3',
        context: {},
      })

      // Should not throw despite one event failing.
      await expect(client.flush()).resolves.not.toThrow()
    })
  })

  describe('auto-flush on batch size', () => {
    it('automatically flushes when batch size is reached', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      // Add 10 events (default batch size).
      for (let i = 0; i < 10; i++) {
        client.track({
          event_sender_created_at: new Date().toISOString(),
          event_type: `event_${i}`,
          context: {},
        })
      }

      // Give time for auto-flush to complete.
      await new Promise(resolve => setTimeout(resolve, tolerantSleep(100)))

      // Events should have been sent.
      expect(mockPostOrgTelemetry).toHaveBeenCalled()
    })
  })

  describe('flush error/timeout branches', () => {
    it('handles errors thrown by setupSdk during flush (lines 351-366)', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })
      // Make the second setupSdk call (the one inside sendEvents) throw.
      mockSetupSdk.mockRejectedValueOnce(new Error('SDK init failed'))
      // Flush swallows the error and discards events.
      await expect(client.flush()).resolves.toBeUndefined()
    })

    it('handles timeout-message errors during flush (lines 356-363)', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })
      // Reject with an error whose message contains "timed out" — exercises
      // the timeout-detection branch in the flush() catch block.
      mockSetupSdk.mockRejectedValueOnce(
        new Error('Telemetry flush timed out after 2000ms'),
      )
      await expect(client.flush()).resolves.toBeUndefined()
    })
  })

  describe('destroy error/timeout branches', () => {
    it('handles errors thrown during destroy flush (lines 459-478)', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })
      // The next setupSdk call (inside destroy → sendEvents) throws.
      mockSetupSdk.mockRejectedValueOnce(new Error('SDK init failed'))
      // destroy() should not throw even when its internal flush fails.
      await expect(client.destroy()).resolves.toBeUndefined()
    })

    it('handles timeout-message errors during destroy flush (lines 463-473)', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })
      mockSetupSdk.mockRejectedValueOnce(
        new Error('flush during destroy timed out after 2000ms'),
      )
      await expect(client.destroy()).resolves.toBeUndefined()
    })
  })
})
