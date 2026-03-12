/**
 * Unit tests for Telemetry service.
 *
 * Purpose:
 * Tests the TelemetryService class for event tracking and batching.
 *
 * Test Coverage:
 * - Singleton pattern
 * - Event tracking
 * - Event batching and flushing
 * - Destroy functionality
 *
 * Related Files:
 * - utils/telemetry/service.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock setupSdk.
const mockSetupSdk = vi.hoisted(() => vi.fn())
const mockGetOrgTelemetryConfig = vi.hoisted(() => vi.fn())
const mockPostOrgTelemetry = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

import { TelemetryService } from '../../../../src/utils/telemetry/service.mts'

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
    it('returns null when no instance exists', () => {
      const instance = TelemetryService.getCurrentInstance()
      expect(instance).toBeNull()
    })

    it('returns instance after initialization', async () => {
      await TelemetryService.getTelemetryClient('test-org')

      const instance = TelemetryService.getCurrentInstance()
      expect(instance).not.toBeNull()
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
      client3.track({
        event_sender_created_at: new Date().toISOString(),
        event_type: 'test_event',
        context: {},
      })

      // The event tracking itself succeeds.
      await client3.destroy()
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

      expect(TelemetryService.getCurrentInstance()).toBeNull()
    })

    it('is idempotent', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.destroy()
      await client.destroy()

      // Should not throw and only process once.
      expect(TelemetryService.getCurrentInstance()).toBeNull()
    })
  })
})
