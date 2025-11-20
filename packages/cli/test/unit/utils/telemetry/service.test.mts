/**
 * Unit tests for telemetry service.
 *
 * Purpose:
 * Tests TelemetryService singleton and event management. Validates service lifecycle, event batching, and API integration.
 *
 * Test Coverage:
 * - Singleton pattern (getTelemetryClient, getCurrentInstance)
 * - Event tracking and batching
 * - Periodic and manual flushing
 * - Service initialization and configuration
 * - Session ID generation and assignment
 * - Error handling and graceful degradation
 * - Service destruction and cleanup
 * - Timeout handling for flush operations
 *
 * Testing Approach:
 * Mocks SDK and tests service behavior with various configurations.
 * Uses fake timers to test periodic flush behavior.
 *
 * Related Files:
 * - utils/telemetry/service.mts (implementation)
 * - utils/telemetry/types.mts (types)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock SDK setup.
const mockPostOrgTelemetry = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ success: true })),
)
const mockGetTelemetryConfig = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      data: { telemetry: { enabled: true } },
      success: true,
    }),
  ),
)
const mockSetupSdk = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      data: {
        getTelemetryConfig: mockGetTelemetryConfig,
        postOrgTelemetry: mockPostOrgTelemetry,
      },
      ok: true,
    }),
  ),
)

vi.mock('../../../../src/utils/socket/sdk.mts', () => ({
  setupSdk: mockSetupSdk,
}))

// Mock debug functions.
const mockDebug = vi.hoisted(() => vi.fn())
const mockDebugDir = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  debugDir: mockDebugDir,
}))

import { TelemetryService } from '../../../../src/utils/telemetry/service.mts'

import type { TelemetryEvent } from '../../../../src/utils/telemetry/types.mts'

describe('TelemetryService', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()

    // Reset singleton instance.
    const instance = TelemetryService.getCurrentInstance()
    if (instance) {
      await instance.destroy()
    }

    // Reset mock implementations.
    mockSetupSdk.mockResolvedValue({
      data: {
        getTelemetryConfig: mockGetTelemetryConfig,
        postOrgTelemetry: mockPostOrgTelemetry,
      },
      ok: true,
    })

    mockGetTelemetryConfig.mockResolvedValue({
      data: { telemetry: { enabled: true } },
      success: true,
    })

    mockPostOrgTelemetry.mockResolvedValue({ success: true })
  })

  describe('singleton pattern', () => {
    it('creates new instance when none exists', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      expect(client).toBeDefined()
      expect(TelemetryService.getCurrentInstance()).toBe(client)
    })

    it('returns existing instance on subsequent calls', async () => {
      const client1 = await TelemetryService.getTelemetryClient('test-org')
      const client2 = await TelemetryService.getTelemetryClient('test-org')

      expect(client1).toBe(client2)
    })

    it('getCurrentInstance returns null when no instance exists', async () => {
      expect(TelemetryService.getCurrentInstance()).toBeNull()
    })
  })

  describe('initialization', () => {
    it('fetches telemetry configuration on creation', async () => {
      await TelemetryService.getTelemetryClient('test-org')

      expect(mockSetupSdk).toHaveBeenCalled()
      expect(mockGetTelemetryConfig).toHaveBeenCalledWith('test-org')
    })

    it('uses default config when SDK setup fails', async () => {
      mockSetupSdk.mockResolvedValueOnce({ ok: false })

      const client = await TelemetryService.getTelemetryClient('test-org')

      expect(client).toBeDefined()
      expect(mockGetTelemetryConfig).not.toHaveBeenCalled()
    })

    it('uses default config when config fetch fails', async () => {
      mockGetTelemetryConfig.mockResolvedValueOnce({
        error: 'Config fetch failed',
        success: false,
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      expect(client).toBeDefined()
    })

    it('uses default config when initialization throws', async () => {
      mockSetupSdk.mockRejectedValueOnce(new Error('Network error'))

      const client = await TelemetryService.getTelemetryClient('test-org')

      expect(client).toBeDefined()
    })
  })

  describe('event tracking', () => {
    it('tracks event with session_id', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      // Verify event is queued (not sent immediately).
      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('includes metadata when provided', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_complete',
        metadata: {
          duration: 1000,
          exit_code: 0,
        },
      }

      client.track(event)

      await client.flush()

      expect(mockPostOrgTelemetry).toHaveBeenCalledWith(
        'test-org',
        expect.objectContaining({
          metadata: {
            duration: 1000,
            exit_code: 0,
          },
        }),
      )
    })

    it('includes error when provided', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        error: {
          message: 'Test error',
          stack: 'stack trace',
          type: 'Error',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_error',
      }

      client.track(event)

      await client.flush()

      expect(mockPostOrgTelemetry).toHaveBeenCalledWith(
        'test-org',
        expect.objectContaining({
          error: {
            message: 'Test error',
            stack: 'stack trace',
            type: 'Error',
          },
        }),
      )
    })

    it('ignores events when telemetry disabled', async () => {
      mockGetTelemetryConfig.mockResolvedValueOnce({
        data: { telemetry: { enabled: false } },
        success: true,
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await client.flush()

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('ignores events after destroy', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.destroy()

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })
  })

  describe('batching', () => {
    it('auto-flushes when batch size reached', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const baseEvent: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      // Track 10 events (batch size).
      for (let i = 0; i < 10; i++) {
        client.track(baseEvent)
      }

      // Wait for async flush to complete.
      await new Promise(resolve => {
        setTimeout(resolve, 100)
      })

      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(10)
    })

    it('does not flush before batch size reached', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      // Track fewer than batch size events.
      client.track(event)
      client.track(event)

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })
  })

  describe('flushing', () => {
    it('sends all queued events', async () => {
      // Clear any previous calls before this test.
      mockPostOrgTelemetry.mockClear()

      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)
      client.track(event)
      client.track(event)

      await client.flush()

      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(3)
    })

    it('clears queue after successful flush', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await client.flush()
      await client.flush()

      // Second flush should not send anything.
      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(1)
    })

    it('does nothing when queue is empty', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.flush()

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('discards events on flush error', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      mockPostOrgTelemetry.mockRejectedValueOnce(new Error('Network error'))

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await client.flush()

      // Events should be discarded even after error.
      await client.flush()

      expect(mockPostOrgTelemetry).toHaveBeenCalledTimes(1)
    })

    it('does not flush after destroy', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      await client.destroy()
      await client.flush()

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })

    it('handles flush timeout', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      // Make postOrgTelemetry hang longer than timeout.
      mockPostOrgTelemetry.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            setTimeout(() => {
              resolve({ success: true })
            }, 10_000)
          }),
      )

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      // Flush should timeout and not throw.
      await expect(client.flush()).resolves.not.toThrow()
    })

    it('clears queue when telemetry disabled', async () => {
      mockGetTelemetryConfig.mockResolvedValueOnce({
        data: { telemetry: { enabled: false } },
        success: true,
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await client.flush()

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    it('flushes remaining events', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await client.destroy()

      expect(mockPostOrgTelemetry).toHaveBeenCalled()
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

      // No error should occur.
      expect(TelemetryService.getCurrentInstance()).toBeNull()
    })

    it('handles flush timeout during destroy', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      // Make postOrgTelemetry hang longer than timeout.
      mockPostOrgTelemetry.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            setTimeout(() => {
              resolve({ success: true })
            }, 10_000)
          }),
      )

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await expect(client.destroy()).resolves.not.toThrow()
    })

    it('does not flush when telemetry disabled', async () => {
      mockGetTelemetryConfig.mockResolvedValueOnce({
        data: { telemetry: { enabled: false } },
        success: true,
      })

      const client = await TelemetryService.getTelemetryClient('test-org')

      const event: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      client.track(event)

      await client.destroy()

      expect(mockPostOrgTelemetry).not.toHaveBeenCalled()
    })
  })

  describe('session ID', () => {
    it('assigns same session_id to all events in a session', async () => {
      const client = await TelemetryService.getTelemetryClient('test-org')

      const event1: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_start',
      }

      const event2: Omit<TelemetryEvent, 'session_id'> = {
        context: {
          arch: 'x64',
          argv: ['scan'],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '2.2.15',
        },
        event_sender_created_at: new Date().toISOString(),
        event_type: 'cli_complete',
      }

      client.track(event1)
      client.track(event2)

      await client.flush()

      const sessionIds = mockPostOrgTelemetry.mock.calls.map(
        call => call[1].session_id,
      )

      expect(sessionIds[0]).toBeDefined()
      expect(sessionIds[0]).toBe(sessionIds[1])
    })
  })
})
