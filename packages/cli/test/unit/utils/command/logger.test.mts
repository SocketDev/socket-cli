/**
 * Unit tests for command logger utilities.
 *
 * Purpose:
 * Tests the command-scoped logger functionality.
 *
 * Test Coverage:
 * - createCommandLogger function
 * - createOperationLogger function
 * - createDebugLogger function
 * - getLogger, clearLogger, clearAllLoggers functions
 *
 * Related Files:
 * - src/utils/command/logger.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
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

import {
  clearAllLoggers,
  clearLogger,
  createCommandLogger,
  createDebugLogger,
  createOperationLogger,
  getLogger,
} from '../../../../src/utils/command/logger.mts'

describe('command logger utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearAllLoggers()
  })

  describe('createCommandLogger', () => {
    it('creates logger with command name', () => {
      const logger = createCommandLogger('scan:create')

      expect(logger.commandName).toBe('scan:create')
    })

    it('prefixes log messages by default', () => {
      const logger = createCommandLogger('test-cmd')

      logger.log('test message')

      expect(mockLogger.log).toHaveBeenCalledWith('[test-cmd]', 'test message')
    })

    it('prefixes all log levels', () => {
      const logger = createCommandLogger('test-cmd')

      logger.info('info')
      logger.warn('warn')
      logger.error('error')
      logger.fail('fail')
      logger.success('success')

      expect(mockLogger.info).toHaveBeenCalledWith('[test-cmd]', 'info')
      expect(mockLogger.warn).toHaveBeenCalledWith('[test-cmd]', 'warn')
      expect(mockLogger.error).toHaveBeenCalledWith('[test-cmd]', 'error')
      expect(mockLogger.fail).toHaveBeenCalledWith('[test-cmd]', 'fail')
      expect(mockLogger.success).toHaveBeenCalledWith('[test-cmd]', 'success')
    })

    it('can disable prefix', () => {
      const logger = createCommandLogger('test-cmd', { includePrefix: false })

      logger.log('test message')

      expect(mockLogger.log).toHaveBeenCalledWith('test message')
    })

    it('supports custom prefix format', () => {
      const logger = createCommandLogger('test-cmd', {
        formatPrefix: name => `{${name}}`,
      })

      logger.log('test message')

      expect(mockLogger.log).toHaveBeenCalledWith('{test-cmd}', 'test message')
    })

    it('handles multiple arguments', () => {
      const logger = createCommandLogger('test-cmd')

      logger.log('arg1', 'arg2', { key: 'value' })

      expect(mockLogger.log).toHaveBeenCalledWith('[test-cmd]', 'arg1', 'arg2', {
        key: 'value',
      })
    })
  })

  describe('createOperationLogger', () => {
    it('creates scoped logger with operation name', () => {
      const cmdLogger = createCommandLogger('scan')
      const opLogger = createOperationLogger(cmdLogger, 'fetch')

      expect(opLogger.commandName).toBe('scan:fetch')
    })

    it('prefixes with combined name', () => {
      const cmdLogger = createCommandLogger('repository')
      const opLogger = createOperationLogger(cmdLogger, 'validate')

      opLogger.log('validating...')

      expect(mockLogger.log).toHaveBeenCalledWith(
        '[repository:validate]',
        'validating...',
      )
    })
  })

  describe('createDebugLogger', () => {
    const originalDebug = process.env['DEBUG']

    afterEach(() => {
      if (originalDebug !== undefined) {
        process.env['DEBUG'] = originalDebug
      } else {
        delete process.env['DEBUG']
      }
    })

    it('returns no-op when DEBUG is not set', () => {
      delete process.env['DEBUG']

      const debug = createDebugLogger('socket:cli:test')
      debug('test message')

      expect(mockLogger.log).not.toHaveBeenCalled()
    })

    it('logs when DEBUG matches namespace exactly', () => {
      process.env['DEBUG'] = 'socket:cli:test'

      const debug = createDebugLogger('socket:cli:test')
      debug('test message')

      expect(mockLogger.log).toHaveBeenCalledWith(
        '[socket:cli:test]',
        'test message',
      )
    })

    it('logs when DEBUG is wildcard', () => {
      process.env['DEBUG'] = '*'

      const debug = createDebugLogger('anything:here')
      debug('test message')

      expect(mockLogger.log).toHaveBeenCalledWith(
        '[anything:here]',
        'test message',
      )
    })

    it('logs when DEBUG matches with wildcard pattern', () => {
      process.env['DEBUG'] = 'socket:*'

      const debug = createDebugLogger('socket:cli:scan')
      debug('test message')

      expect(mockLogger.log).toHaveBeenCalledWith(
        '[socket:cli:scan]',
        'test message',
      )
    })

    it('supports comma-separated namespaces', () => {
      process.env['DEBUG'] = 'other,socket:cli:test,another'

      const debug = createDebugLogger('socket:cli:test')
      debug('test message')

      expect(mockLogger.log).toHaveBeenCalled()
    })
  })

  describe('getLogger', () => {
    it('creates new logger when not cached', () => {
      const logger = getLogger('new-command')

      expect(logger.commandName).toBe('new-command')
    })

    it('returns cached logger on subsequent calls', () => {
      const logger1 = getLogger('cached-command')
      const logger2 = getLogger('cached-command')

      expect(logger1).toBe(logger2)
    })

    it('creates different loggers for different commands', () => {
      const logger1 = getLogger('command-1')
      const logger2 = getLogger('command-2')

      expect(logger1).not.toBe(logger2)
      expect(logger1.commandName).toBe('command-1')
      expect(logger2.commandName).toBe('command-2')
    })
  })

  describe('clearLogger', () => {
    it('removes logger from cache', () => {
      const logger1 = getLogger('clear-test')
      clearLogger('clear-test')
      const logger2 = getLogger('clear-test')

      // Should be different instances since cache was cleared.
      expect(logger1).not.toBe(logger2)
    })
  })

  describe('clearAllLoggers', () => {
    it('removes all loggers from cache', () => {
      const logger1 = getLogger('test-1')
      const logger2 = getLogger('test-2')

      clearAllLoggers()

      const logger1b = getLogger('test-1')
      const logger2b = getLogger('test-2')

      expect(logger1).not.toBe(logger1b)
      expect(logger2).not.toBe(logger2b)
    })
  })
})
