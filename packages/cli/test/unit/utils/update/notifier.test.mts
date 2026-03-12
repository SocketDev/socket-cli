/**
 * Unit tests for update notifier utilities.
 *
 * Purpose:
 * Tests the update notification formatting and display.
 *
 * Test Coverage:
 * - formatUpdateMessage function
 * - showUpdateNotification function
 * - scheduleExitNotification function
 *
 * Related Files:
 * - src/utils/update/notifier.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Mock signal-exit.
const mockOnExit = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/signal-exit', () => ({
  onExit: mockOnExit,
}))

// Mock SEA detect.
const mockGetSeaBinaryPath = vi.hoisted(() => vi.fn(() => ''))
vi.mock('../../../../src/utils/sea/detect.mts', () => ({
  getSeaBinaryPath: mockGetSeaBinaryPath,
}))

// Mock terminal link utilities.
vi.mock('../../../../src/utils/terminal/link.mts', () => ({
  githubRepoLink: (
    org: string,
    repo: string,
    path: string,
    text: string,
  ): string => `https://github.com/${org}/${repo}/${path} (${text})`,
  socketPackageLink: (
    ecosystem: string,
    name: string,
    path: string,
    text: string,
  ): string => `https://socket.dev/${ecosystem}/package/${name}/${path} (${text})`,
}))

import {
  formatUpdateMessage,
  scheduleExitNotification,
  showUpdateNotification,
} from '../../../../src/utils/update/notifier.mts'

describe('update notifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSeaBinaryPath.mockReturnValue('')
  })

  describe('formatUpdateMessage', () => {
    it('formats update message for npm installation', () => {
      const result = formatUpdateMessage({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(result.message).toContain('socket')
      expect(result.message).toContain('1.0.0')
      expect(result.message).toContain('2.0.0')
      expect(result.command).toBeUndefined()
      expect(result.changelog).toContain('socket.dev')
    })

    it('formats update message for SEA binary', () => {
      mockGetSeaBinaryPath.mockReturnValue('/usr/local/bin/socket')

      const result = formatUpdateMessage({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(result.message).toContain('socket')
      expect(result.command).toContain('/usr/local/bin/socket')
      expect(result.command).toContain('self-update')
      expect(result.changelog).toContain('github.com')
    })

    it('includes changelog link for npm', () => {
      const result = formatUpdateMessage({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(result.changelog).toContain('CHANGELOG.md')
      expect(result.changelog).toContain('2.0.0')
    })

    it('includes changelog link for SEA', () => {
      mockGetSeaBinaryPath.mockReturnValue('/usr/local/bin/socket')

      const result = formatUpdateMessage({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(result.changelog).toContain('CHANGELOG.md')
      expect(result.changelog).toContain('SocketDev')
      expect(result.changelog).toContain('socket-cli')
    })
  })

  describe('showUpdateNotification', () => {
    const originalIsTTY = process.stdout?.isTTY

    beforeEach(() => {
      // Mock TTY.
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      })
    })

    it('shows notification when TTY is available', () => {
      showUpdateNotification({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(mockLogger.log).toHaveBeenCalled()
      const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('socket')
    })

    it('does not show notification when not TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      })

      showUpdateNotification({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(mockLogger.log).not.toHaveBeenCalled()
    })

    it('shows command for SEA binary', () => {
      mockGetSeaBinaryPath.mockReturnValue('/usr/local/bin/socket')

      showUpdateNotification({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('self-update')
    })

    it('shows changelog link', () => {
      showUpdateNotification({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('CHANGELOG.md')
    })

    it('handles formatting errors gracefully with npm installation', () => {
      // First call throws, subsequent calls succeed.
      let callCount = 0
      mockLogger.log.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('Formatting error')
        }
      })

      // Should not throw.
      expect(() =>
        showUpdateNotification({
          name: 'socket',
          current: '1.0.0',
          latest: '2.0.0',
        }),
      ).not.toThrow()

      // Fallback message should be shown.
      const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('socket')
    })

    it('handles formatting errors gracefully with SEA binary', () => {
      mockGetSeaBinaryPath.mockReturnValue('/usr/local/bin/socket')

      // First call throws, subsequent calls succeed.
      let callCount = 0
      mockLogger.log.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          throw new Error('Formatting error')
        }
      })

      // Should not throw.
      expect(() =>
        showUpdateNotification({
          name: 'socket',
          current: '1.0.0',
          latest: '2.0.0',
        }),
      ).not.toThrow()

      // Fallback message with self-update command should be shown.
      const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('socket')
    })
  })

  describe('scheduleExitNotification', () => {
    const originalIsTTY = process.stdout?.isTTY

    beforeEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      })
    })

    it('schedules exit notification when TTY', () => {
      scheduleExitNotification({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(mockOnExit).toHaveBeenCalledWith(expect.any(Function))
    })

    it('does not schedule when not TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      })

      scheduleExitNotification({
        name: 'socket',
        current: '1.0.0',
        latest: '2.0.0',
      })

      expect(mockOnExit).not.toHaveBeenCalled()
    })

    it('handles onExit errors gracefully', () => {
      mockOnExit.mockImplementation(() => {
        throw new Error('Failed to register')
      })

      // Should not throw.
      expect(() =>
        scheduleExitNotification({
          name: 'socket',
          current: '1.0.0',
          latest: '2.0.0',
        }),
      ).not.toThrow()

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to schedule exit notification'),
      )
    })
  })
})
