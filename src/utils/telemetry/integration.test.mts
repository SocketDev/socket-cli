/**
 * Unit tests for telemetry integration helpers.
 *
 * Purpose:
 * Tests telemetry tracking utilities for CLI lifecycle and subprocess events.
 *
 * Test Coverage:
 * - CLI lifecycle tracking (start, complete, error)
 * - Subprocess tracking (start, complete, error, exit)
 * - Argument sanitization (tokens, paths, package names)
 * - Context building (version, platform, node version, arch)
 * - Error normalization and sanitization
 * - Event metadata handling
 * - Telemetry finalization and flushing
 *
 * Testing Approach:
 * Mocks TelemetryService and SDK to test integration logic without network calls.
 *
 * Related Files:
 * - utils/telemetry/integration.mts (implementation)
 * - utils/telemetry/service.mts (service implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock TelemetryService.
const mockTrack = vi.hoisted(() => vi.fn())
const mockFlush = vi.hoisted(() => vi.fn())
const mockDestroy = vi.hoisted(() => vi.fn())
const mockGetTelemetryClient = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      destroy: mockDestroy,
      flush: mockFlush,
      track: mockTrack,
    }),
  ),
)
const mockGetCurrentInstance = vi.hoisted(() =>
  vi.fn(() => ({
    destroy: mockDestroy,
    flush: mockFlush,
    track: mockTrack,
  })),
)

vi.mock('./service.mts', () => ({
  TelemetryService: {
    getCurrentInstance: mockGetCurrentInstance,
    getTelemetryClient: mockGetTelemetryClient,
  },
}))

// Mock debug functions.
const mockDebugFn = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugFn: mockDebugFn,
}))

// Mock config function.
const mockGetConfigValueOrUndef = vi.hoisted(() => vi.fn(() => 'test-org'))
vi.mock('../config.mts', () => ({
  getConfigValueOrUndef: mockGetConfigValueOrUndef,
}))

// Mock constants.
vi.mock('../../constants.mts', () => ({
  default: {
    ENV: {
      INLINED_SOCKET_CLI_VERSION: '1.1.34',
    },
  },
  CONFIG_KEY_DEFAULT_ORG: 'defaultOrg',
}))

import {
  finalizeTelemetry,
  trackCliComplete,
  trackCliError,
  trackCliEvent,
  trackCliStart,
  trackEvent,
  trackSubprocessComplete,
  trackSubprocessError,
  trackSubprocessExit,
  trackSubprocessStart,
} from './integration.mts'

describe('telemetry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfigValueOrUndef.mockReturnValue('test-org')
  })

  describe('finalizeTelemetry', () => {
    it('destroys telemetry when instance exists', async () => {
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

  describe('trackEvent', () => {
    const mockContext = {
      arch: 'x64',
      argv: ['scan'],
      node_version: 'v20.0.0',
      platform: 'darwin',
      version: '2.2.15',
    }

    it('tracks event with context and metadata', async () => {
      await trackEvent('test_event', mockContext, { foo: 'bar' })

      expect(mockGetTelemetryClient).toHaveBeenCalledWith('test-org')
      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: mockContext,
          event_type: 'test_event',
          metadata: { foo: 'bar' },
        }),
      )
    })

    it('tracks event with error details', async () => {
      const error = new Error('Test error')
      await trackEvent('test_event', mockContext, {}, { error })

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            message: 'Test error',
            stack: expect.any(String),
            type: 'Error',
          },
        }),
      )
    })

    it('flushes when flush option is true', async () => {
      await trackEvent('test_event', mockContext, {}, { flush: true })

      expect(mockFlush).toHaveBeenCalled()
    })

    it('does not track when org slug is undefined', async () => {
      mockGetConfigValueOrUndef.mockReturnValueOnce(undefined)

      await trackEvent('test_event', mockContext)

      expect(mockGetTelemetryClient).not.toHaveBeenCalled()
      expect(mockTrack).not.toHaveBeenCalled()
    })

    it('does not throw when telemetry client fails', async () => {
      mockGetTelemetryClient.mockRejectedValueOnce(
        new Error('Client creation failed'),
      )

      await expect(trackEvent('test_event', mockContext)).resolves.not.toThrow()
    })

    it('omits metadata when empty', async () => {
      await trackEvent('test_event', mockContext, {})

      expect(mockTrack).toHaveBeenCalledWith(
        expect.not.objectContaining({
          metadata: expect.anything(),
        }),
      )
    })
  })

  describe('trackCliStart', () => {
    it('returns start timestamp', async () => {
      const startTime = await trackCliStart(['node', 'socket', 'scan'])

      expect(typeof startTime).toBe('number')
      expect(startTime).toBeGreaterThan(0)
    })

    it('tracks cli_start event with sanitized argv', async () => {
      await trackCliStart(['node', 'socket', 'scan', '--token', 'sktsec_abc'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan', '--token', '[REDACTED]'],
          }),
          event_type: 'cli_start',
        }),
      )
    })
  })

  describe('trackCliEvent', () => {
    it('tracks custom event with metadata', async () => {
      await trackCliEvent('custom_event', ['node', 'socket', 'scan'], {
        key: 'value',
      })

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'custom_event',
          metadata: { key: 'value' },
        }),
      )
    })

    it('tracks custom event without metadata', async () => {
      await trackCliEvent('custom_event', ['node', 'socket', 'scan'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.not.objectContaining({
          metadata: expect.anything(),
        }),
      )
    })
  })

  describe('trackCliComplete', () => {
    it('tracks cli_complete event with duration', async () => {
      const startTime = Date.now() - 1000
      await trackCliComplete(['node', 'socket', 'scan'], startTime, 0)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'cli_complete',
          metadata: expect.objectContaining({
            duration: expect.any(Number),
            exit_code: 0,
          }),
        }),
      )
      expect(mockFlush).toHaveBeenCalled()
    })

    it('normalizes exit code when string', async () => {
      const startTime = Date.now()
      await trackCliComplete(['node', 'socket', 'scan'], startTime, '0')

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            exit_code: 0,
          }),
        }),
      )
    })

    it('uses default exit code when null', async () => {
      const startTime = Date.now()
      await trackCliComplete(['node', 'socket', 'scan'], startTime, null)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            exit_code: 0,
          }),
        }),
      )
    })
  })

  describe('trackCliError', () => {
    it('tracks cli_error event with error details', async () => {
      const startTime = Date.now() - 500
      const error = new Error('Test error')

      await trackCliError(['node', 'socket', 'scan'], startTime, error, 1)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Test error',
            type: 'Error',
          }),
          event_type: 'cli_error',
          metadata: expect.objectContaining({
            duration: expect.any(Number),
            exit_code: 1,
          }),
        }),
      )
      expect(mockFlush).toHaveBeenCalled()
    })

    it('normalizes non-Error objects', async () => {
      const startTime = Date.now()
      await trackCliError(['node', 'socket', 'scan'], startTime, 'string error')

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'string error',
            type: 'Error',
          }),
        }),
      )
    })

    it('uses default exit code when not provided', async () => {
      const startTime = Date.now()
      const error = new Error('Test')

      await trackCliError(['node', 'socket', 'scan'], startTime, error)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            exit_code: 1,
          }),
        }),
      )
    })
  })

  describe('trackSubprocessStart', () => {
    it('returns start timestamp', async () => {
      const startTime = await trackSubprocessStart('npm')

      expect(typeof startTime).toBe('number')
      expect(startTime).toBeGreaterThan(0)
    })

    it('tracks subprocess_start event with command', async () => {
      await trackSubprocessStart('npm', { cwd: '/path' })

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'subprocess_start',
          metadata: expect.objectContaining({
            command: 'npm',
            cwd: '/path',
          }),
        }),
      )
    })

    it('tracks subprocess_start without metadata', async () => {
      await trackSubprocessStart('coana')

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            command: 'coana',
          }),
        }),
      )
    })
  })

  describe('trackSubprocessComplete', () => {
    it('tracks subprocess_complete event with duration', async () => {
      const startTime = Date.now() - 2000
      await trackSubprocessComplete('npm', startTime, 0)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'subprocess_complete',
          metadata: expect.objectContaining({
            command: 'npm',
            duration: expect.any(Number),
            exit_code: 0,
          }),
        }),
      )
    })

    it('includes additional metadata', async () => {
      const startTime = Date.now()
      await trackSubprocessComplete('npm', startTime, 0, {
        stdout_length: 1234,
      })

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            stdout_length: 1234,
          }),
        }),
      )
    })
  })

  describe('trackSubprocessError', () => {
    it('tracks subprocess_error event with error details', async () => {
      const startTime = Date.now() - 1000
      const error = new Error('Subprocess failed')

      await trackSubprocessError('npm', startTime, error, 1)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Subprocess failed',
            type: 'Error',
          }),
          event_type: 'subprocess_error',
          metadata: expect.objectContaining({
            command: 'npm',
            duration: expect.any(Number),
            exit_code: 1,
          }),
        }),
      )
    })

    it('includes additional metadata', async () => {
      const startTime = Date.now()
      const error = new Error('Test')

      await trackSubprocessError('npm', startTime, error, 1, { stderr: 'log' })

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            stderr: 'log',
          }),
        }),
      )
    })
  })

  describe('trackSubprocessExit', () => {
    it('tracks completion when exit code is 0', async () => {
      const startTime = Date.now()
      await trackSubprocessExit('npm', startTime, 0)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'subprocess_complete',
        }),
      )
      expect(mockFlush).toHaveBeenCalled()
    })

    it('tracks error when exit code is non-zero', async () => {
      const startTime = Date.now()
      await trackSubprocessExit('npm', startTime, 1)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'npm exited with code 1',
          }),
          event_type: 'subprocess_error',
        }),
      )
      expect(mockFlush).toHaveBeenCalled()
    })

    it('does not track when exit code is null', async () => {
      const startTime = Date.now()
      await trackSubprocessExit('npm', startTime, null)

      expect(mockTrack).not.toHaveBeenCalled()
      expect(mockFlush).toHaveBeenCalled()
    })

    it('handles numeric exit codes correctly', async () => {
      const startTime = Date.now()
      await trackSubprocessExit('npm', startTime, 42)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'npm exited with code 42',
          }),
          event_type: 'subprocess_error',
          metadata: expect.objectContaining({
            exit_code: 42,
          }),
        }),
      )
    })

    it('handles negative exit codes', async () => {
      const startTime = Date.now()
      await trackSubprocessExit('npm', startTime, -1)

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'npm exited with code -1',
          }),
          event_type: 'subprocess_error',
        }),
      )
    })

    it('flushes telemetry regardless of exit code', async () => {
      const startTime = Date.now()

      // Test with successful exit.
      await trackSubprocessExit('npm', startTime, 0)
      expect(mockFlush).toHaveBeenCalledTimes(1)

      // Test with error exit.
      await trackSubprocessExit('npm', startTime, 1)
      expect(mockFlush).toHaveBeenCalledTimes(2)

      // Test with null exit.
      await trackSubprocessExit('npm', startTime, null)
      expect(mockFlush).toHaveBeenCalledTimes(3)
    })
  })

  describe('argv sanitization', () => {
    it('strips node and script paths', async () => {
      await trackCliStart(['node', '/path/socket', 'scan'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan'],
          }),
        }),
      )
    })

    it('redacts API tokens after flags', async () => {
      await trackCliStart([
        'node',
        'socket',
        'scan',
        '--api-token',
        'sktsec_secret',
      ])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan', '--api-token', '[REDACTED]'],
          }),
        }),
      )
    })

    it('redacts socket tokens starting with sktsec_', async () => {
      await trackCliStart(['node', 'socket', 'scan', 'sktsec_abc123def'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan', '[REDACTED]'],
          }),
        }),
      )
    })

    it('redacts hex tokens', async () => {
      await trackCliStart([
        'node',
        'socket',
        'scan',
        'abcdef1234567890abcdef1234567890',
      ])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan', '[REDACTED]'],
          }),
        }),
      )
    })

    it('replaces home directory with tilde', async () => {
      const homeDir = require('node:os').homedir()
      await trackCliStart(['node', 'socket', 'scan', `${homeDir}/projects/app`])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan', '~/projects/app'],
          }),
        }),
      )
    })

    it('strips arguments after npm wrapper', async () => {
      await trackCliStart([
        'node',
        'socket',
        'npm',
        'install',
        '@my/private-package',
      ])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['npm'],
          }),
        }),
      )
    })

    it('strips arguments after yarn wrapper', async () => {
      await trackCliStart(['node', 'socket', 'yarn', 'add', 'private-pkg'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['yarn'],
          }),
        }),
      )
    })

    it('strips arguments after pip wrapper', async () => {
      await trackCliStart(['node', 'socket', 'pip', 'install', 'flask'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['pip'],
          }),
        }),
      )
    })

    it('preserves non-wrapper commands fully', async () => {
      await trackCliStart(['node', 'socket', 'scan', '--json', '--all'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            argv: ['scan', '--json', '--all'],
          }),
        }),
      )
    })
  })

  describe('context building', () => {
    it('includes CLI version', async () => {
      await trackCliStart(['node', 'socket', 'scan'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            version: '1.1.34',
          }),
        }),
      )
    })

    it('includes platform', async () => {
      await trackCliStart(['node', 'socket', 'scan'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            platform: process.platform,
          }),
        }),
      )
    })

    it('includes node version', async () => {
      await trackCliStart(['node', 'socket', 'scan'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            node_version: process.version,
          }),
        }),
      )
    })

    it('includes architecture', async () => {
      await trackCliStart(['node', 'socket', 'scan'])

      expect(mockTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            arch: process.arch,
          }),
        }),
      )
    })
  })
})
