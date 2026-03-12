/**
 * Unit tests for Telemetry integration utilities.
 *
 * Purpose:
 * Tests the telemetry integration helper functions.
 *
 * Test Coverage:
 * - finalizeTelemetry function
 * - finalizeTelemetrySync function
 * - setupTelemetryExitHandlers function
 * - trackSubprocessExit function
 * - sanitizeArgv function (via buildContext)
 * - trackEvent function
 * - trackCliStart function
 * - trackCliEvent function
 * - trackCliComplete function
 * - trackCliError function
 * - trackSubprocessStart function
 * - trackSubprocessComplete function
 * - trackSubprocessError function
 *
 * Related Files:
 * - utils/telemetry/integration.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TelemetryService.
const mockFlush = vi.hoisted(() => vi.fn())
const mockTrack = vi.hoisted(() => vi.fn())
const mockDestroy = vi.hoisted(() => vi.fn())
const mockGetCurrentInstance = vi.hoisted(() =>
  vi.fn(() => ({
    destroy: mockDestroy,
    flush: mockFlush,
    track: mockTrack,
  })),
)
const mockGetTelemetryClient = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      destroy: mockDestroy,
      flush: mockFlush,
      track: mockTrack,
    }),
  ),
)

vi.mock('../../../../src/utils/telemetry/service.mts', () => ({
  TelemetryService: {
    getCurrentInstance: mockGetCurrentInstance,
    getTelemetryClient: mockGetTelemetryClient,
  },
}))

// Mock config.
const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/utils/config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

// Mock constants - set VITEST to false to enable telemetry tracking.
vi.mock('../../../../src/constants.mts', () => ({
  CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
  default: {
    ENV: {
      INLINED_SOCKET_CLI_VERSION: '1.0.0-test',
      VITEST: false,
    },
  },
}))

// Mock homedir.
vi.mock('node:os', () => ({
  homedir: () => '/Users/testuser',
}))

// Mock debug.
vi.mock('@socketsecurity/lib/debug', () => ({
  debugNs: vi.fn(),
}))

import {
  finalizeTelemetry,
  finalizeTelemetrySync,
  setupTelemetryExitHandlers,
  trackCliComplete,
  trackCliError,
  trackCliEvent,
  trackCliStart,
  trackEvent,
  trackSubprocessComplete,
  trackSubprocessError,
  trackSubprocessExit,
  trackSubprocessStart,
} from '../../../../src/utils/telemetry/integration.mts'

describe('telemetry/integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfigValueOrUndef.mockReturnValue('test-org')
  })

  describe('finalizeTelemetry', () => {
    it('flushes telemetry when instance exists', async () => {
      await finalizeTelemetry()

      expect(mockGetCurrentInstance).toHaveBeenCalled()
      expect(mockFlush).toHaveBeenCalled()
    })

    it('does nothing when no instance exists', async () => {
      mockGetCurrentInstance.mockReturnValueOnce(null)

      await finalizeTelemetry()

      expect(mockGetCurrentInstance).toHaveBeenCalled()
      expect(mockFlush).not.toHaveBeenCalled()
    })
  })

  describe('finalizeTelemetrySync', () => {
    it('triggers flush when instance exists', () => {
      finalizeTelemetrySync()

      expect(mockGetCurrentInstance).toHaveBeenCalled()
      expect(mockFlush).toHaveBeenCalled()
    })

    it('does nothing when no instance exists', () => {
      mockGetCurrentInstance.mockReturnValueOnce(null)

      finalizeTelemetrySync()

      expect(mockGetCurrentInstance).toHaveBeenCalled()
      expect(mockFlush).not.toHaveBeenCalled()
    })
  })

  describe('setupTelemetryExitHandlers', () => {
    it('registers exit handlers', () => {
      const processOnSpy = vi.spyOn(process, 'on')

      setupTelemetryExitHandlers()

      expect(processOnSpy).toHaveBeenCalled()
      processOnSpy.mockRestore()
    })
  })

  describe('trackSubprocessExit', () => {
    it('tracks error when exit code is non-zero', async () => {
      await trackSubprocessExit('npm', Date.now() - 1000, 1)

      expect(mockTrack).toHaveBeenCalled()
      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('subprocess_error')
    })

    it('tracks completion when exit code is zero', async () => {
      await trackSubprocessExit('npm', Date.now() - 1000, 0)

      expect(mockTrack).toHaveBeenCalled()
      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('subprocess_complete')
    })

    it('does not track when exit code is null', async () => {
      await trackSubprocessExit('npm', Date.now() - 1000, null)

      // Only finalize is called, no track.
      expect(mockFlush).toHaveBeenCalled()
    })
  })

  describe('trackEvent', () => {
    it('tracks event with context', async () => {
      await trackEvent('test_event', {
        arch: 'x64',
        argv: ['socket', 'scan'],
        node_version: 'v20.0.0',
        platform: 'darwin',
        version: '1.0.0',
      })

      expect(mockGetTelemetryClient).toHaveBeenCalledWith('test-org')
      expect(mockTrack).toHaveBeenCalled()
    })

    it('includes metadata when provided', async () => {
      await trackEvent(
        'test_event',
        {
          arch: 'x64',
          argv: [],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '1.0.0',
        },
        { custom_field: 'value' },
      )

      const call = mockTrack.mock.calls[0][0]
      expect(call.metadata).toEqual({ custom_field: 'value' })
    })

    it('includes error when provided', async () => {
      const error = new Error('Test error')
      await trackEvent(
        'test_event',
        {
          arch: 'x64',
          argv: [],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '1.0.0',
        },
        {},
        { error },
      )

      const call = mockTrack.mock.calls[0][0]
      expect(call.error).toBeDefined()
      expect(call.error.message).toBe('Test error')
    })

    it('flushes when flush option is true', async () => {
      await trackEvent(
        'test_event',
        {
          arch: 'x64',
          argv: [],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '1.0.0',
        },
        {},
        { flush: true },
      )

      expect(mockFlush).toHaveBeenCalled()
    })

    it('does not track when no org slug', async () => {
      mockGetConfigValueOrUndef.mockReturnValue(undefined)

      await trackEvent('test_event', {
        arch: 'x64',
        argv: [],
        node_version: 'v20.0.0',
        platform: 'darwin',
        version: '1.0.0',
      })

      expect(mockGetTelemetryClient).not.toHaveBeenCalled()
      expect(mockTrack).not.toHaveBeenCalled()
    })

    it('handles telemetry errors gracefully', async () => {
      mockGetTelemetryClient.mockRejectedValueOnce(new Error('Service error'))

      await expect(
        trackEvent('test_event', {
          arch: 'x64',
          argv: [],
          node_version: 'v20.0.0',
          platform: 'darwin',
          version: '1.0.0',
        }),
      ).resolves.not.toThrow()
    })
  })

  describe('trackCliStart', () => {
    it('returns start timestamp', async () => {
      const startTime = await trackCliStart(['node', 'socket', 'scan'])

      expect(typeof startTime).toBe('number')
      expect(startTime).toBeGreaterThan(0)
    })

    it('tracks cli_start event', async () => {
      await trackCliStart(['node', 'socket', 'scan'])

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('cli_start')
    })
  })

  describe('trackCliEvent', () => {
    it('tracks custom event type', async () => {
      await trackCliEvent('custom_event', ['node', 'socket', 'scan'])

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('custom_event')
    })

    it('includes optional metadata', async () => {
      await trackCliEvent('custom_event', ['node', 'socket', 'scan'], {
        custom: 'value',
      })

      const call = mockTrack.mock.calls[0][0]
      expect(call.metadata).toEqual({ custom: 'value' })
    })
  })

  describe('trackCliComplete', () => {
    it('tracks cli_complete event with duration', async () => {
      const startTime = Date.now() - 1000
      await trackCliComplete(['node', 'socket', 'scan'], startTime, 0)

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('cli_complete')
      expect(call.metadata.duration).toBeGreaterThanOrEqual(1000)
      expect(call.metadata.exit_code).toBe(0)
    })

    it('flushes after tracking', async () => {
      await trackCliComplete(['node', 'socket', 'scan'], Date.now(), 0)

      expect(mockFlush).toHaveBeenCalled()
    })
  })

  describe('trackCliError', () => {
    it('tracks cli_error event with error details', async () => {
      const error = new Error('Test error')
      await trackCliError(
        ['node', 'socket', 'scan'],
        Date.now() - 500,
        error,
        1,
      )

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('cli_error')
      expect(call.error).toBeDefined()
      expect(call.error.message).toBe('Test error')
    })

    it('normalizes non-Error values', async () => {
      await trackCliError(
        ['node', 'socket', 'scan'],
        Date.now(),
        'string error',
        1,
      )

      const call = mockTrack.mock.calls[0][0]
      expect(call.error.message).toBe('string error')
    })
  })

  describe('trackSubprocessStart', () => {
    it('returns start timestamp', async () => {
      const startTime = await trackSubprocessStart('npm')

      expect(typeof startTime).toBe('number')
      expect(startTime).toBeGreaterThan(0)
    })

    it('tracks subprocess_start event', async () => {
      await trackSubprocessStart('npm', { cwd: '/path' })

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('subprocess_start')
      expect(call.metadata.command).toBe('npm')
      expect(call.metadata.cwd).toBe('/path')
    })
  })

  describe('trackSubprocessComplete', () => {
    it('tracks subprocess_complete event', async () => {
      await trackSubprocessComplete('npm', Date.now() - 500, 0, {
        stdout_length: 100,
      })

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('subprocess_complete')
      expect(call.metadata.command).toBe('npm')
      expect(call.metadata.exit_code).toBe(0)
    })
  })

  describe('trackSubprocessError', () => {
    it('tracks subprocess_error event', async () => {
      const error = new Error('Process failed')
      await trackSubprocessError('npm', Date.now() - 500, error, 1)

      const call = mockTrack.mock.calls[0][0]
      expect(call.event_type).toBe('subprocess_error')
      expect(call.error).toBeDefined()
    })
  })

  describe('sanitizeArgv (via buildContext)', () => {
    it('sanitizes API tokens from argv', async () => {
      // Use a fake token pattern that matches the sanitizer (sktsec_ prefix).
      const prefix = 'sktsec'
      const fakeToken = `${prefix}_testvalue123`
      await trackCliStart(['node', 'socket', 'scan', '--token', fakeToken])

      const call = mockTrack.mock.calls[0][0]
      expect(call.context.argv).toContain('[REDACTED]')
      expect(call.context.argv).not.toContain(fakeToken)
    })

    it('replaces home directory with tilde', async () => {
      await trackCliStart([
        'node',
        'socket',
        'scan',
        '/Users/testuser/project',
      ])

      const call = mockTrack.mock.calls[0][0]
      expect(call.context.argv).toContain('~/project')
    })

    it('strips arguments after wrapper CLI commands', async () => {
      await trackCliStart([
        'node',
        'socket',
        'npm',
        'install',
        '@my/private-package',
      ])

      const call = mockTrack.mock.calls[0][0]
      // Should only have 'npm', not 'install' or package name.
      expect(call.context.argv).toEqual(['npm'])
    })

    it('redacts hex tokens', async () => {
      await trackCliStart([
        'node',
        'socket',
        'scan',
        'abc123def456789012345678901234567890',
      ])

      const call = mockTrack.mock.calls[0][0]
      expect(call.context.argv).toContain('[REDACTED]')
    })
  })
})
