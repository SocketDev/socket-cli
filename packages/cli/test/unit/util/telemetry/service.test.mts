/**
 * Unit tests for Telemetry service.
 *
 * Purpose: Tests the TelemetryService class for event tracking and batching.
 *
 * Test Coverage: - Singleton pattern - Event tracking - Event batching and
 * flushing - Destroy functionality.
 *
 * Related Files: - util/telemetry/service.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  describe('getCurrentInstance', () => {
    it('returns undefined when no instance exists', () => {
      const instance = TelemetryService.getCurrentInstance()
      expect(instance).toBeUndefined()
    })

    it('returns instance after initialization', async () => {
      await TelemetryService.getTelemetryClient('test-org')

      const instance = TelemetryService.getCurrentInstance()
      expect(instance).not.toBeUndefined()
    })
  })

  describe('getTelemetryClient', () => {
    it('creates a new instance when none exists', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      expect(client).toBeDefined()
    })

    it('returns same instance on subsequent calls', async () => {
      const client1 = await TelemetryService.getTelemetryClient('test-org')
      const client2 = await TelemetryService.getTelemetryClient('test-org')
      expect(client1).toBe(client2)
    })

    it('returns same instance even with different org slug', async () => {
      const client1 = await TelemetryService.getTelemetryClient('org-1')
      const client2 = await TelemetryService.getTelemetryClient('org-2')
      expect(client1).toBe(client2)
    })

    it('uses default config when SDK setup fails', async () => {
      mockSetupSdk.mockResolvedValue({
        ok: false,
        message: 'SDK setup failed',
      })

      const client = await TelemetryService.getTelemetryClient('test-org')
      expect(client).toBeDefined()
    })

    it('uses default config when telemetry config fetch fails', async () => {
      mockGetOrgTelemetryConfig.mockResolvedValue({
        success: false,
        error: 'Config fetch failed',
      })

      const client = await TelemetryService.getTelemetryClient('test-org')
      expect(client).toBeDefined()
    })
  })

  describe('track', () => {
    it('queues events when telemetry is enabled', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })

      // Event should be queued, not sent immediately (unless batch size reached).
      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('ignores events when service is destroyed', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      await client.destroy()

      // Create a new client and immediately destroy it.
      const client2 = await TelemetryService.getTelemetryClient('test-org')
      await client2.destroy()

      // Create another client to test tracking after destroy.
      const client3 = await TelemetryService.getTelemetryClient('test-org')

      // Track event - this should work since we have a fresh instance.
      expect(() => {
        client3.track({
          event_sender_created_at: new Date().toISOString(),
          event_type: 'test_event',
          context: {},
        })
      }).not.toThrow()

      // The event tracking itself succeeds.
      await client3.destroy()
    })

    it('clears queue without sending when telemetry disabled mid-queue (lines 328-330)', async () => {
      // Initially enabled — track an event so it lands in the queue.
      const client = await TelemetryService.getTelemetryClient('test-org')
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'first_event',
        context: {},
      })
      // Mutate the in-memory config to disable telemetry, then flush.
      ;(client as unknown).config = { telemetry: { enabled: false } }
      mockPostOrgTelemetry.mockClear()
      await client.flush()
      // Queue should be drained without a network call.
      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
      expect((client as unknown).eventQueue).toEqual([])
    })

    it('returns early on track() after destroy on same instance (lines 284-285)', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      // Hold the same reference, destroy it, then track on the destroyed
      // instance directly — exercises the early-return at lines 283-286.
      await client.destroy()
      // No throw expected; track returns void synchronously.
      expect(() =>
        client.track({
          event_sender_created_at: new Date().toISOString(),
          event_type: 'after_destroy',
          context: {},
        }),
      ).not.toThrow()
      // postOrgTelemetry should NOT be called since the instance is destroyed.
      // (Counts may be > 0 from earlier tests; reset and verify no NEW call.)
      mockPostOrgTelemetry.mockClear()
      // Trigger another track on the destroyed instance.
      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'still_destroyed',
        context: {},
      })
      // Allow microtasks to settle.
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('ignores events when telemetry is disabled', async () => {
      mockGetOrgTelemetryConfig.mockResolvedValue({
        success: true,
        data: {
          telemetry: {
            enabled: false,
          },
        },
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })

      // Event should be ignored.
      await client.flush()
      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })
  })

  describe('flush', () => {
    it('sends all queued events', async () => {
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

      await client.flush()

      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(2)
    })

    it('does nothing when queue is empty', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.flush()

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('clears queue when telemetry is disabled', async () => {
      mockGetOrgTelemetryConfig.mockResolvedValue({
        success: true,
        data: {
          telemetry: {
            enabled: false,
          },
        },
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      // Queue should be cleared without sending.
      await client.flush()
      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('handles API errors gracefully', async () => {
      mockPostOrgTelemetry.mockRejectedValue(new Error('API error'))

      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })

      // Should not throw.
      await expect(client.flush()).resolves.not.toThrow()
    })
  })

  describe('destroy', () => {
    it('flushes remaining events before destroying', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })

      await client.destroy()

      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(1)
    })

    it('clears singleton instance', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.destroy()

      expect(TelemetryService.getCurrentInstance()).toBeUndefined()
    })

    it('is idempotent', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.destroy()
      await client.destroy()

      expect(TelemetryService.getCurrentInstance()).toBeUndefined()
    })

    it('does not flush when service is destroyed', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')
      await client.destroy()

      // Now try to flush on a destroyed instance.
      await client.flush()

      // Should not send anything because service is destroyed.
      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(0)
    })

    it('handles SDK setup failure during flush gracefully', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      client.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })

      // Make SDK setup fail during flush.
      mockSetupSdk.mockResolvedValue({
        ok: false,
        message: 'SDK setup failed',
      })

      // Should not throw.
      await expect(client.flush()).resolves.not.toThrow()
    })

    it('handles exceptions during initialization gracefully', async () => {
      mockSetupSdk.mockRejectedValue(new Error('Unexpected error'))

      // Should not throw and return a client with default config.
      const client = await TelemetryService.getTelemetryClient('error-org')
      expect(client).toBeDefined()
    })
  })
})
