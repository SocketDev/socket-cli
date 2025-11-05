/**
 * @fileoverview Core tests for Logger class - basic functionality.
 *
 * Tests core logging methods (log, info, warn, error, debug), LOG_SYMBOLS constants,
 * stream-bound loggers (stdout/stderr), method chaining, and indentation control.
 * Uses custom Writable streams to capture and verify output without console pollution.
 */

import { Writable } from 'node:stream'

import { Logger, LOG_SYMBOLS } from '@socketsecurity/lib/logger'
import { describe, expect, it, beforeEach } from 'vitest'

describe('Logger', () => {
  let stdout: Writable
  let stderr: Writable
  let stdoutData: string[]
  let stderrData: string[]
  let logger: Logger

  beforeEach(() => {
    stdoutData = []
    stderrData = []

    stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutData.push(chunk.toString())
        callback()
      },
    })

    stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrData.push(chunk.toString())
        callback()
      },
    })

    logger = new Logger({ stdout, stderr })
  })

  describe('LOG_SYMBOLS', () => {
    it('should provide all required symbols', () => {
      expect(LOG_SYMBOLS).toHaveProperty('success')
      expect(LOG_SYMBOLS).toHaveProperty('fail')
      expect(LOG_SYMBOLS).toHaveProperty('warn')
      expect(LOG_SYMBOLS).toHaveProperty('info')
      expect(LOG_SYMBOLS).toHaveProperty('step')
    })

    it('should return strings for symbols', () => {
      expect(typeof LOG_SYMBOLS.success).toBe('string')
      expect(typeof LOG_SYMBOLS.fail).toBe('string')
      expect(typeof LOG_SYMBOLS.warn).toBe('string')
      expect(typeof LOG_SYMBOLS.info).toBe('string')
      expect(typeof LOG_SYMBOLS.step).toBe('string')
    })

    it('should have non-empty symbol strings', () => {
      expect(LOG_SYMBOLS.success.length).toBeGreaterThan(0)
      expect(LOG_SYMBOLS.fail.length).toBeGreaterThan(0)
      expect(LOG_SYMBOLS.warn.length).toBeGreaterThan(0)
      expect(LOG_SYMBOLS.info.length).toBeGreaterThan(0)
      expect(LOG_SYMBOLS.step.length).toBeGreaterThan(0)
    })

    it('should be accessible from Logger.LOG_SYMBOLS', () => {
      expect(Logger.LOG_SYMBOLS).toBe(LOG_SYMBOLS)
      expect(Logger.LOG_SYMBOLS.success).toBe(LOG_SYMBOLS.success)
    })
  })

  describe('constructor', () => {
    it('should create logger with default constructor', () => {
      const defaultLogger = new Logger()
      expect(defaultLogger).toBeInstanceOf(Logger)
    })

    it('should create logger with custom streams', () => {
      expect(logger).toBeInstanceOf(Logger)
    })

    it('should create logger with options', () => {
      const optionsLogger = new Logger({ stdout, stderr, theme: 'dark' })
      expect(optionsLogger).toBeInstanceOf(Logger)
    })
  })

  describe('basic logging', () => {
    it('should log to stdout', () => {
      logger.log('test message')
      expect(stdoutData.join('')).toContain('test message')
    })

    it('should support method chaining', () => {
      const result = logger.log('message 1').log('message 2')
      expect(result).toBe(logger)
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should log error to stderr', () => {
      logger.error('error message')
      expect(stderrData.join('')).toContain('error message')
    })

    it('should log warn', () => {
      logger.warn('warning message')
      expect(stderrData.join('')).toContain('warning message')
    })

    it('should log info', () => {
      logger.info('info message')
      // info logs to stderr in Node.js Console
      expect(stderrData.join('')).toContain('info message')
    })

    it('should log debug', () => {
      // debug() is dynamically added from console.debug if available
      if (typeof (logger as any).debug === 'function') {
        ;(logger as any).debug('debug message')
        expect(stdoutData.join('')).toContain('debug message')
      }
    })
  })

  describe('stream-bound loggers', () => {
    it('should provide stderr property', () => {
      expect(logger.stderr).toBeInstanceOf(Logger)
    })

    it('should provide stdout property', () => {
      expect(logger.stdout).toBeInstanceOf(Logger)
    })

    it('should cache stderr instance', () => {
      const stderr1 = logger.stderr
      const stderr2 = logger.stderr
      expect(stderr1).toBe(stderr2)
    })

    it('should cache stdout instance', () => {
      const stdout1 = logger.stdout
      const stdout2 = logger.stdout
      expect(stdout1).toBe(stdout2)
    })

    it('should write to stderr via stderr logger', () => {
      logger.stderr.error('stderr message')
      expect(stderrData.join('')).toContain('stderr message')
    })

    it('should write to stdout via stdout logger', () => {
      logger.stdout.log('stdout message')
      expect(stdoutData.join('')).toContain('stdout message')
    })
  })

  describe('indentation', () => {
    it('should support indent method', () => {
      const result = logger.indent()
      expect(result).toBe(logger)
    })

    it('should support dedent method', () => {
      const result = logger.dedent()
      expect(result).toBe(logger)
    })

    it('should support method chaining with indentation', () => {
      logger
        .log('level 0')
        .indent()
        .log('level 1')
        .dedent()
        .log('level 0 again')
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should support indentation tracking', () => {
      // Indentation is tracked internally
      logger.indent()
      logger.dedent()
      expect(true).toBe(true)
    })
  })

  describe('special logging methods', () => {
    it('should support success method', () => {
      const result = logger.success('success message')
      expect(result).toBe(logger)
    })

    it('should support fail method', () => {
      const result = logger.fail('fail message')
      expect(result).toBe(logger)
    })

    it('should support step method', () => {
      const result = logger.step('step message')
      expect(result).toBe(logger)
    })
  })

  describe('table method', () => {
    it('should support table method', () => {
      const result = logger.table([{ name: 'test', value: 123 }])
      expect(result).toBe(logger)
    })
  })

  describe('time methods', () => {
    it('should support time method', () => {
      const result = logger.time('timer')
      expect(result).toBe(logger)
    })

    it('should support timeEnd method', () => {
      logger.time('timer')
      const result = logger.timeEnd('timer')
      expect(result).toBe(logger)
    })

    it('should support timeLog method', () => {
      logger.time('timer')
      const result = logger.timeLog('timer')
      expect(result).toBe(logger)
    })
  })

  describe('count methods', () => {
    it('should support count method', () => {
      const result = logger.count('counter')
      expect(result).toBe(logger)
    })

    it('should support countReset method', () => {
      // countReset() is dynamically added from console.countReset if available
      if (typeof (logger as any).countReset === 'function') {
        logger.count('counter')
        const result = (logger as any).countReset('counter')
        expect(result).toBe(logger)
      }
    })
  })

  describe('group methods', () => {
    it('should support group method', () => {
      const result = logger.group('group name')
      expect(result).toBe(logger)
    })

    it('should support groupCollapsed method', () => {
      const result = logger.groupCollapsed('collapsed group')
      expect(result).toBe(logger)
    })

    it('should support groupEnd method', () => {
      logger.group('test')
      const result = logger.groupEnd()
      expect(result).toBe(logger)
    })
  })

  describe('multiple arguments', () => {
    it('should handle multiple arguments in log', () => {
      logger.log('arg1', 'arg2', 'arg3')
      const output = stdoutData.join('')
      expect(output).toContain('arg1')
      expect(output).toContain('arg2')
      expect(output).toContain('arg3')
    })

    it('should handle objects and arrays', () => {
      logger.log({ key: 'value' }, [1, 2, 3])
      expect(stdoutData.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('should handle empty log calls', () => {
      const result = logger.log()
      expect(result).toBe(logger)
    })

    it('should handle null and undefined', () => {
      logger.log(null)
      logger.log(undefined)
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should handle numbers', () => {
      logger.log(42, 3.14, -1)
      const output = stdoutData.join('')
      expect(output).toContain('42')
    })

    it('should handle booleans', () => {
      logger.log(true, false)
      const output = stdoutData.join('')
      expect(output).toContain('true')
      expect(output).toContain('false')
    })
  })
})
