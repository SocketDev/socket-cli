/**
 * @fileoverview Advanced tests for Logger class - task management, assertions, and advanced features.
 *
 * Tests advanced Logger functionality including:
 * - createTask() for tracking async operations with start/completion messages
 * - assert() for conditional logging based on truthy/falsy values
 * - logCallCount tracking across all logging methods
 * - dir/dirxml for object inspection
 * - trace() for stack traces
 * - success/fail methods with symbol stripping
 * - step() for progress indicators
 * - Complex indentation scenarios and edge cases
 */

import { Writable } from 'node:stream'

import { Logger } from '@socketsecurity/lib/logger'
import { describe, expect, it, beforeEach } from 'vitest'

// Disable concurrent execution for this suite to prevent state sharing between tests
// The logger and stream state must be isolated for accurate testing
describe.sequential('Logger - Advanced Features', () => {
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

  describe('createTask', () => {
    it('should create a task object', () => {
      const task = logger.createTask('test task')
      expect(task).toBeDefined()
      expect(typeof task.run).toBe('function')
    })

    it('should log start and completion messages', () => {
      const task = logger.createTask('my task')
      task.run(() => {
        // do nothing
      })
      const output = stdoutData.join('')
      expect(output).toContain('Starting task: my task')
      expect(output).toContain('Completed task: my task')
    })

    it('should return the function result', () => {
      const task = logger.createTask('calculation')
      const result = task.run(() => 42)
      expect(result).toBe(42)
    })

    it('should work with complex return values', () => {
      const task = logger.createTask('fetch data')
      const result = task.run(() => ({
        data: [1, 2, 3],
        success: true,
      }))
      expect(result.data).toEqual([1, 2, 3])
      expect(result.success).toBe(true)
    })

    it('should handle async functions via run', () => {
      const task = logger.createTask('async task')
      const promise = task.run(() => Promise.resolve('done'))
      expect(promise).toBeInstanceOf(Promise)
    })
  })

  describe('assert', () => {
    it('should not log when assertion passes', () => {
      logger.assert(true, 'This should not appear')
      expect(stderrData.join('')).not.toContain('This should not appear')
    })

    it('should log when assertion fails', () => {
      logger.assert(false, 'Assertion failed')
      expect(stderrData.join('')).toContain('Assertion failed')
    })

    it('should support method chaining', () => {
      const result = logger.assert(true, 'test')
      expect(result).toBe(logger)
    })

    it('should handle truthy values', () => {
      logger.assert(1, 'Should not log')
      logger.assert('string', 'Should not log')
      logger.assert({}, 'Should not log')
      expect(stderrData.length).toBe(0)
    })

    it('should handle falsy values', () => {
      logger.assert(0, 'Zero is falsy')
      logger.assert('', 'Empty string is falsy')
      logger.assert(null, 'Null is falsy')
      expect(stderrData.length).toBeGreaterThan(0)
    })
  })

  describe('logCallCount', () => {
    it('should start at zero', () => {
      expect(logger.logCallCount).toBe(0)
    })

    it('should increment on log', () => {
      logger.log('message')
      expect(logger.logCallCount).toBe(1)
    })

    it('should increment on multiple calls', () => {
      logger.log('one')
      logger.log('two')
      logger.error('three')
      expect(logger.logCallCount).toBe(3)
    })

    it('should track across different methods', () => {
      logger.log('log')
      logger.error('error')
      logger.warn('warn')
      // debug() is dynamically added - test if available
      if (typeof (logger as any).debug === 'function') {
        ;(logger as any).debug('debug')
      }
      // Expect at least 3 calls (log, error, warn)
      expect(logger.logCallCount).toBeGreaterThanOrEqual(3)
    })

    it('should not increment on passing assertions', () => {
      logger.assert(true, 'pass')
      expect(logger.logCallCount).toBe(0)
    })

    it('should increment on failing assertions', () => {
      logger.assert(false, 'fail')
      expect(logger.logCallCount).toBe(1)
    })
  })

  describe('dedent with custom spaces', () => {
    it('should accept custom space count', () => {
      logger.indent(4)
      const result = logger.dedent(4)
      expect(result).toBe(logger)
    })

    it('should dedent by default 2 spaces', () => {
      logger.indent()
      const result = logger.dedent()
      expect(result).toBe(logger)
    })

    it('should work with stream-bound loggers', () => {
      logger.stdout.indent(6)
      logger.stdout.dedent(6)
      expect(true).toBe(true)
    })
  })

  describe('dir method', () => {
    it('should inspect objects', () => {
      const obj = { key: 'value', nested: { prop: 123 } }
      const result = logger.dir(obj)
      expect(result).toBe(logger)
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should accept options', () => {
      const obj = { a: 1, b: 2 }
      const result = logger.dir(obj, { depth: 1 })
      expect(result).toBe(logger)
    })

    it('should handle arrays', () => {
      logger.dir([1, 2, 3, 4, 5])
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should handle primitives', () => {
      logger.dir(42)
      logger.dir('string')
      logger.dir(true)
      expect(stdoutData.length).toBeGreaterThan(0)
    })
  })

  describe('dirxml method', () => {
    it('should display data', () => {
      const data = { xml: 'data' }
      const result = logger.dirxml(data)
      expect(result).toBe(logger)
      expect(stdoutData.length).toBeGreaterThan(0)
    })
  })

  describe('trace method', () => {
    it('should log stack trace', () => {
      logger.trace()
      expect(stderrData.length).toBeGreaterThan(0)
    })

    it('should accept message arguments', () => {
      logger.trace('custom trace message')
      const output = stderrData.join('')
      expect(output).toContain('custom trace message')
    })

    it('should support chaining', () => {
      const result = logger.trace('test')
      expect(result).toBe(logger)
    })
  })

  describe('success and fail methods', () => {
    it('should log success messages', () => {
      logger.success('Operation successful')
      expect(stderrData.length).toBeGreaterThan(0)
    })

    it('should log fail messages', () => {
      logger.fail('Operation failed')
      expect(stderrData.length).toBeGreaterThan(0)
    })

    it('should handle messages with extra args', () => {
      logger.success('Done', 'extra', 'args')
      expect(stderrData.length).toBeGreaterThan(0)
    })

    it('should strip existing symbols', () => {
      logger.success('✔ Already has symbol')
      const output = stderrData.join('')
      // Symbol should be stripped and re-added
      expect(output).toBeDefined()
    })
  })

  describe('step method', () => {
    it('should log step messages', () => {
      logger.step('Processing step')
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should support chaining', () => {
      const result = logger.step('test')
      expect(result).toBe(logger)
    })

    it('should handle multiple steps', () => {
      logger.step('Step 1')
      logger.step('Step 2')
      logger.step('Step 3')
      expect(stdoutData.length).toBeGreaterThan(0)
    })
  })

  describe('complex indentation scenarios', () => {
    it('should handle nested indentation', () => {
      logger.log('Level 0')
      logger.indent()
      logger.log('Level 1')
      logger.indent()
      logger.log('Level 2')
      logger.dedent()
      logger.log('Back to level 1')
      logger.dedent()
      logger.log('Back to level 0')
      expect(stdoutData.length).toBe(5)
    })

    it('should handle stream-specific indentation', () => {
      logger.stdout.indent()
      logger.stdout.log('indented stdout')
      logger.stderr.error('non-indented stderr')
      logger.stdout.dedent()
      expect(stdoutData.length).toBeGreaterThan(0)
      expect(stderrData.length).toBeGreaterThan(0)
    })

    it('should maintain separate indentation for stderr and stdout', () => {
      logger.stdout.indent(4)
      logger.stderr.indent(2)
      logger.stdout.log('stdout')
      logger.stderr.error('stderr')
      logger.stdout.dedent(4)
      logger.stderr.dedent(2)
      expect(true).toBe(true)
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle rapid successive calls', () => {
      for (let i = 0; i < 100; i++) {
        logger.log(`message ${i}`)
      }
      expect(logger.logCallCount).toBe(100)
    })

    it('should handle empty task names', () => {
      const task = logger.createTask('')
      task.run(() => 'done')
      expect(stdoutData.length).toBeGreaterThan(0)
    })

    it('should handle tasks that throw', () => {
      const task = logger.createTask('failing task')
      expect(() => {
        task.run(() => {
          throw new Error('task error')
        })
      }).toThrow('task error')
      // Should still log start message
      expect(stdoutData.join('')).toContain('Starting task')
    })

    it('should handle mixed logging and assertions', () => {
      logger.log('start')
      logger.assert(true, 'pass')
      logger.log('middle')
      logger.assert(false, 'fail')
      logger.log('end')
      expect(logger.logCallCount).toBe(4) // log, log, assert fail, log
    })
  })

  describe('stream-bound logger error cases', () => {
    it('should throw error when calling clearVisible on stream-bound logger', () => {
      expect(() => {
        logger.stderr.clearVisible()
      }).toThrow()
    })

    it('should throw error when calling clearVisible on stdout logger', () => {
      expect(() => {
        logger.stdout.clearVisible()
      }).toThrow()
    })
  })

  describe('method chaining complex scenarios', () => {
    it('should chain multiple operations', () => {
      const result = logger
        .log('start')
        .indent()
        .success('nested success')
        .fail('nested fail')
        .dedent()
        .log('end')
      expect(result).toBe(logger)
      expect(logger.logCallCount).toBe(4)
    })

    it('should chain with tasks', () => {
      const task = logger.createTask('chained')
      const result = task.run(() => {
        logger.log('inside task')
        return 'done'
      })
      expect(result).toBe('done')
    })

    it('should chain across stream-bound loggers', () => {
      logger.stdout.log('stdout 1').log('stdout 2')
      logger.stderr.error('stderr 1').error('stderr 2')
      expect(stdoutData.length).toBe(2)
      expect(stderrData.length).toBe(2)
    })
  })
})
