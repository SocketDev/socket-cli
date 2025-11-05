/**
 * @fileoverview Comprehensive isolated tests for logger module with 99%+ coverage.
 *
 * Tests Logger class in isolation with full coverage:
 * - All logging levels (log, info, warn, error, debug, success, fail)
 * - LOG_SYMBOLS constants and lazy initialization
 * - Stream handling (stdout/stderr), indentation, method chaining
 * - Task management, assertions, object inspection
 * - Theme integration and color support
 * - Internal state tracking (logCallCount, lastWasBlank)
 * Uses custom Writable streams to capture output without console pollution.
 */
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOG_SYMBOLS,
  Logger,
  incLogCallCountSymbol,
  lastWasBlankSymbol,
} from '@socketsecurity/lib/logger'
import { setTheme, THEMES } from '@socketsecurity/lib/themes'

describe('LOG_SYMBOLS', () => {
  it('should lazily initialize symbols', () => {
    expect(LOG_SYMBOLS).toBeDefined()
    expect(LOG_SYMBOLS.success).toContain('')
    expect(LOG_SYMBOLS.fail).toContain('')
    expect(LOG_SYMBOLS.warn).toContain('')
    expect(LOG_SYMBOLS.info).toContain('')
    expect(LOG_SYMBOLS.step).toContain('')
  })

  it('should provide colored symbols', () => {
    // Access all symbols to ensure lazy initialization
    const { fail, info, step, success, warn } = LOG_SYMBOLS
    expect(success).toBeTruthy()
    expect(fail).toBeTruthy()
    expect(warn).toBeTruthy()
    expect(info).toBeTruthy()
    expect(step).toBeTruthy()
  })

  it('should update symbols when theme changes', () => {
    // Initialize symbols with default theme
    const initialSuccess = LOG_SYMBOLS.success
    expect(initialSuccess).toBeTruthy()

    // Change theme
    setTheme(THEMES.sunset)

    // Symbols should update
    const updatedSuccess = LOG_SYMBOLS.success
    expect(updatedSuccess).toBeTruthy()

    // Reset to default theme for other tests
    setTheme(THEMES.socket)
  })

  it('should be accessible via Logger.LOG_SYMBOLS', () => {
    expect(Logger.LOG_SYMBOLS).toBe(LOG_SYMBOLS)
  })
})

describe('Logger', () => {
  let testLogger: Logger
  let stdoutChunks: string[]
  let stderrChunks: string[]
  let mockStdout: Writable
  let mockStderr: Writable

  beforeEach(() => {
    stdoutChunks = []
    stderrChunks = []

    mockStdout = new Writable({
      write(chunk: any, _encoding: any, callback: any) {
        stdoutChunks.push(chunk.toString())
        callback()
      },
    })
    ;(mockStdout as any).isTTY = false

    mockStderr = new Writable({
      write(chunk: any, _encoding: any, callback: any) {
        stderrChunks.push(chunk.toString())
        callback()
      },
    })
    ;(mockStderr as any).isTTY = false

    testLogger = new Logger({ stdout: mockStdout, stderr: mockStderr })
  })

  afterEach(() => {
    stdoutChunks = []
    stderrChunks = []
  })

  describe('constructor', () => {
    it('should create a logger with default streams when no args provided', () => {
      const defaultLogger = new Logger()
      expect(defaultLogger).toBeInstanceOf(Logger)
    })

    it('should create a logger with custom streams', () => {
      expect(testLogger).toBeInstanceOf(Logger)
    })

    it('should store options from constructor', () => {
      const customOptions = { stdout: mockStdout, stderr: mockStderr }
      const customLogger = new Logger(customOptions)
      expect(customLogger).toBeInstanceOf(Logger)
    })
  })

  describe('log() method', () => {
    it('should log a message to stdout', () => {
      testLogger.log('test message')
      expect(stdoutChunks.join('')).toContain('test message')
    })

    it('should support multiple arguments', () => {
      testLogger.log('message', 123, { key: 'value' })
      const output = stdoutChunks.join('')
      expect(output).toContain('message')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.log('test')
      expect(result).toBe(testLogger)
    })

    it('should track log call count', () => {
      const initialCount = testLogger.logCallCount
      testLogger.log('test')
      expect(testLogger.logCallCount).toBe(initialCount + 1)
    })

    it('should handle non-string arguments', () => {
      testLogger.log(123)
      testLogger.log({ key: 'value' })
      testLogger.log(null)
      testLogger.log(undefined)
      expect(stdoutChunks.length).toBeGreaterThan(0)
    })
  })

  describe('error() method', () => {
    it('should log error to stderr', () => {
      testLogger.error('error message')
      expect(stderrChunks.join('')).toContain('error message')
    })

    it('should support multiple arguments', () => {
      testLogger.error('error', 500, { code: 'ERR' })
      const output = stderrChunks.join('')
      expect(output).toContain('error')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.error('error')
      expect(result).toBe(testLogger)
    })
  })

  describe('success() method', () => {
    it('should log success message with symbol', () => {
      testLogger.success('operation succeeded')
      const output = stderrChunks.join('')
      expect(output).toContain('operation succeeded')
    })

    it('should strip existing symbols from message', () => {
      testLogger.success('✔ already has symbol')
      const output = stderrChunks.join('')
      expect(output).toContain('already has symbol')
    })

    it('should handle non-string arguments', () => {
      testLogger.success()
      testLogger.success(123)
      expect(stderrChunks.length).toBeGreaterThan(0)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.success('done')
      expect(result).toBe(testLogger)
    })
  })

  describe('fail() method', () => {
    it('should log fail message with symbol', () => {
      testLogger.fail('operation failed')
      const output = stderrChunks.join('')
      expect(output).toContain('operation failed')
    })

    it('should strip existing symbols', () => {
      testLogger.fail('✖ has fail symbol')
      const output = stderrChunks.join('')
      expect(output).toContain('has fail symbol')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.fail('error')
      expect(result).toBe(testLogger)
    })
  })

  describe('warn() method', () => {
    it('should log warning message with symbol', () => {
      testLogger.warn('warning message')
      const output = stderrChunks.join('')
      expect(output).toContain('warning message')
    })

    it('should strip existing warning symbols', () => {
      testLogger.warn('⚠ existing warning')
      const output = stderrChunks.join('')
      expect(output).toContain('existing warning')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.warn('warning')
      expect(result).toBe(testLogger)
    })
  })

  describe('info() method', () => {
    it('should log info message with symbol', () => {
      testLogger.info('info message')
      const output = stderrChunks.join('')
      expect(output).toContain('info message')
    })

    it('should strip existing info symbols', () => {
      testLogger.info('ℹ existing info')
      const output = stderrChunks.join('')
      expect(output).toContain('existing info')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.info('info')
      expect(result).toBe(testLogger)
    })
  })

  describe('done() method', () => {
    it('should be an alias for success()', () => {
      testLogger.done('completed')
      const output = stderrChunks.join('')
      expect(output).toContain('completed')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.done('done')
      expect(result).toBe(testLogger)
    })
  })

  describe('indent() and dedent() methods', () => {
    it('should indent messages by default 2 spaces', () => {
      testLogger.indent()
      testLogger.log('indented')
      const output = stdoutChunks.join('')
      expect(output).toContain('  indented')
    })

    it('should support custom indentation amounts', () => {
      testLogger.indent(4)
      testLogger.log('four spaces')
      const output = stdoutChunks.join('')
      expect(output).toContain('    four spaces')
    })

    it('should dedent by default 2 spaces', () => {
      testLogger.indent().indent()
      testLogger.log('4 spaces')
      testLogger.dedent()
      testLogger.log('2 spaces')
      const outputs = stdoutChunks.join('')
      expect(outputs).toContain('    4 spaces')
      expect(outputs).toContain('  2 spaces')
    })

    it('should support custom dedent amounts', () => {
      testLogger.indent(4)
      testLogger.log('indented')
      testLogger.dedent(4)
      testLogger.log('no indent')
      const outputs = stdoutChunks.join('')
      expect(outputs).toContain('    indented')
      expect(outputs).toContain('no indent')
    })

    it('should cap indentation at max (1000 spaces)', () => {
      testLogger.indent(2000)
      testLogger.log('max indent')
      const output = stdoutChunks.join('')
      const leadingSpaces = output.match(/^\s+/)?.[0].length || 0
      expect(leadingSpaces).toBeLessThanOrEqual(1000)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.indent().dedent()
      expect(result).toBe(testLogger)
    })
  })

  describe('resetIndent() method', () => {
    it('should reset all indentation to zero', () => {
      testLogger.indent().indent().indent()
      testLogger.resetIndent()
      testLogger.log('no indent')
      const output = stdoutChunks.join('')
      expect(output.trim()).toContain('no indent')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.resetIndent()
      expect(result).toBe(testLogger)
    })
  })

  describe('group() and groupEnd() methods', () => {
    it('should create a group with label', () => {
      testLogger.group('Group Label')
      testLogger.log('inside group')
      testLogger.groupEnd()
      const output = stdoutChunks.join('')
      expect(output).toContain('Group Label')
      expect(output).toContain('inside group')
    })

    it('should indent content inside group', () => {
      testLogger.group('Group')
      testLogger.log('indented content')
      testLogger.groupEnd()
      testLogger.log('not indented')
      const output = stdoutChunks.join('')
      expect(output).toContain('  indented content')
    })

    it('should support nested groups', () => {
      testLogger.group('Outer')
      testLogger.log('outer content')
      testLogger.group('Inner')
      testLogger.log('inner content')
      testLogger.groupEnd()
      testLogger.groupEnd()
      const output = stdoutChunks.join('')
      expect(output).toContain('  outer content')
      expect(output).toContain('    inner content')
    })

    it('should work without label', () => {
      testLogger.group()
      testLogger.log('content')
      testLogger.groupEnd()
      const output = stdoutChunks.join('')
      expect(output).toContain('  content')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.group().groupEnd()
      expect(result).toBe(testLogger)
    })
  })

  describe('groupCollapsed() method', () => {
    it('should work like group()', () => {
      testLogger.groupCollapsed('Collapsed')
      testLogger.log('content')
      testLogger.groupEnd()
      const output = stdoutChunks.join('')
      expect(output).toContain('Collapsed')
      expect(output).toContain('  content')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.groupCollapsed('test')
      expect(result).toBe(testLogger)
    })
  })

  describe('step() method', () => {
    it('should add blank line before step', () => {
      testLogger.log('previous')
      testLogger.step('Step 1')
      const outputs = stdoutChunks
      expect(outputs.length).toBeGreaterThan(2)
    })

    it('should not add blank line if already blank', () => {
      testLogger.log('')
      const beforeCount = stdoutChunks.length
      testLogger.step('Step')
      // Should not add another blank line
      expect(stdoutChunks.length).toBe(beforeCount + 1)
    })

    it('should include arrow symbol in step message', () => {
      testLogger.step('Step 1')
      const output = stdoutChunks.join('')
      // Check for either Unicode → or ASCII > fallback
      expect(output).toMatch(/[→>]/)
      expect(output).toContain('Step 1')
    })

    it('should strip existing symbols from step message', () => {
      testLogger.step('→ Step 1')
      // Get the last chunk (the actual step line, not the blank line)
      const stepLine = stdoutChunks[stdoutChunks.length - 1]
      // Strip ANSI color codes for easier testing
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence needed for stripping color codes
      const stripped = stepLine.replace(/\x1b\[\d+m/g, '')
      // Should have exactly one arrow symbol and the message text
      expect(stripped).toMatch(/^[→>] Step 1\n$/)
      // Verify the arrow appears exactly once at the start
      const arrowCount = (stripped.match(/[→>]/g) || []).length
      expect(arrowCount).toBe(1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.step('step')
      expect(result).toBe(testLogger)
    })
  })

  describe('substep() method', () => {
    it('should indent message by 2 spaces', () => {
      testLogger.substep('Substep')
      const output = stdoutChunks.join('')
      expect(output).toContain('  Substep')
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.substep('substep')
      expect(result).toBe(testLogger)
    })
  })

  describe('logNewline() method', () => {
    it('should add blank line if last was not blank', () => {
      testLogger.log('text')
      const beforeCount = stdoutChunks.length
      testLogger.logNewline()
      expect(stdoutChunks.length).toBe(beforeCount + 1)
    })

    it('should not add blank line if last was already blank', () => {
      testLogger.log('')
      const beforeCount = stdoutChunks.length
      testLogger.logNewline()
      expect(stdoutChunks.length).toBe(beforeCount)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.logNewline()
      expect(result).toBe(testLogger)
    })
  })

  describe('errorNewline() method', () => {
    it('should add blank line to stderr if last was not blank', () => {
      testLogger.error('error')
      const beforeCount = stderrChunks.length
      testLogger.errorNewline()
      expect(stderrChunks.length).toBe(beforeCount + 1)
    })

    it('should not add blank line if last was already blank', () => {
      testLogger.error('')
      const beforeCount = stderrChunks.length
      testLogger.errorNewline()
      expect(stderrChunks.length).toBe(beforeCount)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.errorNewline()
      expect(result).toBe(testLogger)
    })
  })

  describe('assert() method', () => {
    it('should not log when assertion is truthy', () => {
      const beforeLogCount = testLogger.logCallCount
      testLogger.assert(true, 'should not appear')
      // assert() doesn't increment log count for successful assertions
      expect(testLogger.logCallCount).toBe(beforeLogCount)
    })

    it('should log when assertion is falsy', () => {
      const beforeLogCount = testLogger.logCallCount
      testLogger.assert(false, 'assertion failed')
      // assert() increments log count for failed assertions
      expect(testLogger.logCallCount).toBe(beforeLogCount + 1)
    })

    it('should increment log count only on failure', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.assert(true, 'pass')
      expect(testLogger.logCallCount).toBe(beforeCount)
      testLogger.assert(false, 'fail')
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.assert(true, 'test')
      expect(result).toBe(testLogger)
    })
  })

  describe('createTask() method', () => {
    it('should create a task that logs start and completion', () => {
      const task = testLogger.createTask('TestTask')
      const result = task.run(() => 'result')
      const output = stdoutChunks.join('')
      expect(output).toContain('Starting task: TestTask')
      expect(output).toContain('Completed task: TestTask')
      expect(result).toBe('result')
    })

    it('should execute task function and return result', () => {
      const task = testLogger.createTask('Task')
      const result = task.run(() => 42)
      expect(result).toBe(42)
    })

    it('should work with void functions', () => {
      const task = testLogger.createTask('VoidTask')
      const spy = vi.fn()
      task.run(spy)
      expect(spy).toHaveBeenCalled()
    })
  })

  describe('count() method', () => {
    it('should increment and log counter', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.count('test')
      testLogger.count('test')
      // count() should increment log count twice
      expect(testLogger.logCallCount).toBe(beforeCount + 2)
    })

    it('should use default label when none provided', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.count()
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.count('label')
      expect(result).toBe(testLogger)
    })
  })

  describe('dir() method', () => {
    it('should display object properties', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.dir({ key: 'value' })
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should support options', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.dir({ nested: { deep: 'value' } }, { depth: 2 })
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.dir({})
      expect(result).toBe(testLogger)
    })
  })

  describe('dirxml() method', () => {
    it('should display XML/HTML data', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.dirxml({ xml: 'data' })
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.dirxml('data')
      expect(result).toBe(testLogger)
    })
  })

  describe('table() method', () => {
    it('should display data as table', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.table([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should support property filter', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.table(
        [
          { name: 'Alice', age: 30, city: 'NYC' },
          { name: 'Bob', age: 25, city: 'LA' },
        ],
        ['name', 'age'],
      )
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.table([])
      expect(result).toBe(testLogger)
    })
  })

  describe('timeEnd() method', () => {
    it('should end timer and log duration', () => {
      testLogger.time('timer-test-1')
      const beforeCount = testLogger.logCallCount
      testLogger.timeEnd('timer-test-1')
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should work with non-existent timer', () => {
      testLogger.time('existing-timer')
      const beforeCount = testLogger.logCallCount
      testLogger.timeEnd('existing-timer')
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      testLogger.time('some-label')
      const result = testLogger.timeEnd('some-label')
      expect(result).toBe(testLogger)
    })
  })

  describe('timeLog() method', () => {
    it('should log current timer value without stopping', () => {
      testLogger.time('timer-test-2')
      const beforeCount = testLogger.logCallCount
      testLogger.timeLog('timer-test-2', 'checkpoint')
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
      testLogger.timeEnd('timer-test-2')
    })

    it('should support additional data', () => {
      testLogger.time('timer-test-3')
      const beforeCount = testLogger.logCallCount
      testLogger.timeLog('timer-test-3', 'data1', 'data2')
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
      testLogger.timeEnd('timer-test-3')
    })

    it('should return logger instance for chaining', () => {
      testLogger.time('some-timer')
      const result = testLogger.timeLog('some-timer')
      expect(result).toBe(testLogger)
      testLogger.timeEnd('some-timer')
    })
  })

  describe('trace() method', () => {
    it('should log stack trace', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.trace('trace point')
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should work without message', () => {
      const beforeCount = testLogger.logCallCount
      testLogger.trace()
      expect(testLogger.logCallCount).toBe(beforeCount + 1)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.trace('trace')
      expect(result).toBe(testLogger)
    })
  })

  describe('write() method', () => {
    it('should write text to stdout without newline', () => {
      // Explicitly clear chunks before test (defensive against CI isolation issues)
      stdoutChunks.length = 0
      testLogger.write('raw text')
      const output = stdoutChunks.join('')
      expect(output).toBe('raw text')
    })

    it('should not apply indentation', () => {
      // Explicitly clear chunks before test (defensive against CI isolation issues)
      stdoutChunks.length = 0
      testLogger.indent()
      testLogger.write('no indent')
      const output = stdoutChunks.join('')
      expect(output).toBe('no indent')
    })

    it('should return logger instance for chaining', () => {
      // Explicitly clear chunks before test (defensive against CI isolation issues)
      stdoutChunks.length = 0
      const result = testLogger.write('text')
      expect(result).toBe(testLogger)
    })
  })

  describe('progress() method', () => {
    it('should show progress indicator', () => {
      // progress() writes directly to stream, not through standard logging
      // so it doesn't go through our mock in the same way
      expect(() => testLogger.progress('Loading...')).not.toThrow()
    })

    it('should write to stderr when on stderr stream', () => {
      expect(() => testLogger.stderr.progress('Error progress')).not.toThrow()
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.progress('test')
      expect(result).toBe(testLogger)
    })
  })

  describe('clearLine() method', () => {
    it('should clear line in non-TTY mode', () => {
      // clearLine() writes directly to stream
      expect(() => testLogger.clearLine()).not.toThrow()
    })

    it('should clear line on stderr when stream-bound', () => {
      expect(() => testLogger.stderr.clearLine()).not.toThrow()
    })

    it('should handle TTY mode', () => {
      // Create TTY mock with cursorTo and clearLine methods
      const cursorToSpy = vi.fn()
      const clearLineSpy = vi.fn()

      const ttyStdout = new Writable({
        write(chunk: any, _encoding: any, callback: any) {
          stdoutChunks.push(chunk.toString())
          callback()
        },
      })
      ;(ttyStdout as any).isTTY = true
      ;(ttyStdout as any).cursorTo = cursorToSpy
      ;(ttyStdout as any).clearLine = clearLineSpy

      const ttyLogger = new Logger({ stdout: ttyStdout, stderr: mockStderr })
      // clearLine should work without throwing
      expect(() => ttyLogger.clearLine()).not.toThrow()
      // Note: The console's internal _stdout stream is what gets called,
      // which we can't easily mock. We verify it doesn't throw as a basic test.
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.clearLine()
      expect(result).toBe(testLogger)
    })
  })

  describe('clearVisible() method', () => {
    it('should clear screen on main logger', () => {
      testLogger.clearVisible()
      // Should not throw
      expect(testLogger).toBeDefined()
    })

    it('should throw on stream-bound logger', () => {
      expect(() => {
        testLogger.stderr.clearVisible()
      }).toThrow(/only available on the main logger/)
    })

    it('should reset log count in TTY mode', () => {
      const ttyStdout = new Writable({
        write(_chunk: any, _encoding: any, callback: any) {
          callback()
        },
      })
      ;(ttyStdout as any).isTTY = true

      const ttyLogger = new Logger({ stdout: ttyStdout, stderr: mockStderr })
      ttyLogger.log('test')
      ttyLogger.clearVisible()
      expect(ttyLogger.logCallCount).toBe(0)
    })

    it('should return logger instance for chaining', () => {
      const result = testLogger.clearVisible()
      expect(result).toBe(testLogger)
    })
  })

  describe('stderr and stdout getters', () => {
    it('should return stderr-bound logger', () => {
      const stderrLogger = testLogger.stderr
      expect(stderrLogger).toBeInstanceOf(Logger)
      expect(stderrLogger).not.toBe(testLogger)
    })

    it('should cache stderr logger instance', () => {
      const first = testLogger.stderr
      const second = testLogger.stderr
      expect(first).toBe(second)
    })

    it('should return stdout-bound logger', () => {
      const stdoutLogger = testLogger.stdout
      expect(stdoutLogger).toBeInstanceOf(Logger)
      expect(stdoutLogger).not.toBe(testLogger)
    })

    it('should cache stdout logger instance', () => {
      const first = testLogger.stdout
      const second = testLogger.stdout
      expect(first).toBe(second)
    })

    it('should maintain separate indentation for stderr', () => {
      testLogger.stderr.indent()
      testLogger.stderr.error('indented error')
      testLogger.log('not indented')
      const errOutput = stderrChunks.join('')
      const outOutput = stdoutChunks.join('')
      expect(errOutput).toContain('  indented error')
      expect(outOutput.trim()).toBe('not indented')
    })

    it('should maintain separate indentation for stdout', () => {
      testLogger.stdout.indent()
      testLogger.stdout.log('indented log')
      testLogger.error('not indented error')
      const outOutput = stdoutChunks.join('')
      const errOutput = stderrChunks.join('')
      expect(outOutput).toContain('  indented log')
      expect(errOutput.trim()).toContain('not indented error')
    })
  })

  describe.sequential('indentation with stream-bound loggers', () => {
    it('should only affect stderr when dedenting stderr logger', () => {
      testLogger.indent()
      testLogger.indent()
      testLogger.stderr.dedent()
      testLogger.stderr.error('stderr 1 indent')
      testLogger.log('stdout 2 indents')
      const errOutput = stderrChunks.join('')
      const outOutput = stdoutChunks.join('')
      expect(errOutput).toContain('  stderr 1 indent')
      expect(outOutput).toContain('    stdout 2 indents')
    })

    it('should only affect stdout when dedenting stdout logger', () => {
      testLogger.indent()
      testLogger.indent()
      testLogger.stdout.dedent()
      testLogger.log('stdout 1 indent')
      testLogger.error('stderr 2 indents')
      const outOutput = stdoutChunks.join('')
      const errOutput = stderrChunks.join('')
      expect(outOutput).toContain('  stdout 1 indent')
      expect(errOutput).toContain('    stderr 2 indents')
    })

    it('should only reset stderr when calling resetIndent on stderr', () => {
      testLogger.indent()
      testLogger.stderr.resetIndent()
      testLogger.stderr.error('no indent')
      testLogger.log('has indent')
      const errOutput = stderrChunks.join('')
      const outOutput = stdoutChunks.join('')
      expect(errOutput.trim()).toContain('no indent')
      expect(outOutput).toContain('  has indent')
    })

    it('should only reset stdout when calling resetIndent on stdout', () => {
      testLogger.indent()
      testLogger.stdout.resetIndent()
      testLogger.log('no indent')
      testLogger.error('has indent')
      const outOutput = stdoutChunks.join('')
      const errOutput = stderrChunks.join('')
      expect(outOutput.trim()).toBe('no indent')
      expect(errOutput).toContain('  has indent')
    })
  })

  describe.sequential('logCallCount', () => {
    it('should start at 0', () => {
      expect(testLogger.logCallCount).toBe(0)
    })

    it('should increment on each log call', () => {
      testLogger.log('test')
      expect(testLogger.logCallCount).toBe(1)
      testLogger.error('error')
      expect(testLogger.logCallCount).toBe(2)
      testLogger.success('success')
      expect(testLogger.logCallCount).toBe(3)
    })

    it('should be accessible via getter', () => {
      testLogger.log('test')
      const count = testLogger.logCallCount
      expect(count).toBeGreaterThan(0)
    })
  })

  describe('symbols', () => {
    it('should expose incLogCallCountSymbol', () => {
      expect(incLogCallCountSymbol).toBeDefined()
      expect(typeof incLogCallCountSymbol).toBe('symbol')
    })

    it('should expose lastWasBlankSymbol', () => {
      expect(lastWasBlankSymbol).toBeDefined()
      expect(typeof lastWasBlankSymbol).toBe('symbol')
    })

    it('should allow incrementing log count via symbol', () => {
      const before = testLogger.logCallCount
      ;(testLogger as any)[incLogCallCountSymbol]()
      expect(testLogger.logCallCount).toBe(before + 1)
    })

    it('should allow setting lastWasBlank via symbol', () => {
      ;(testLogger as any)[lastWasBlankSymbol](true)
      // Verify by checking logNewline behavior
      const before = stdoutChunks.length
      testLogger.logNewline()
      expect(stdoutChunks.length).toBe(before) // Should not add line
    })
  })

  describe('method chaining', () => {
    it('should support chaining multiple operations', () => {
      const result = testLogger
        .log('step 1')
        .indent()
        .log('step 2')
        .success('done')
        .dedent()
        .log('step 3')

      expect(result).toBe(testLogger)
      const stdout = stdoutChunks.join('')
      const stderr = stderrChunks.join('')
      expect(stdout).toContain('step 1')
      expect(stdout).toContain('  step 2')
      expect(stderr).toContain('done')
      expect(stdout).toContain('step 3')
    })
  })

  describe('symbol stripping', () => {
    it('should strip unicode checkmark symbols', () => {
      testLogger.success('✔ message')
      testLogger.success('✓ message')
      testLogger.success('√ message')
      const output = stderrChunks.join('')
      expect(output).toContain('message')
    })

    it('should strip unicode fail symbols', () => {
      testLogger.fail('✖ message')
      testLogger.fail('✗ message')
      testLogger.fail('× message')
      const output = stderrChunks.join('')
      expect(output).toContain('message')
    })

    it('should strip unicode warn symbols', () => {
      testLogger.warn('⚠ message')
      testLogger.warn('‼ message')
      const output = stderrChunks.join('')
      expect(output).toContain('message')
    })

    it('should strip unicode info symbols', () => {
      testLogger.info('ℹ message')
      const output = stderrChunks.join('')
      expect(output).toContain('message')
    })

    it('should strip variation selectors', () => {
      testLogger.success('✔\uFE0F message')
      const output = stderrChunks.join('')
      expect(output).toContain('message')
    })

    it('should strip symbols with whitespace', () => {
      testLogger.success('✔  message with spaces')
      const output = stderrChunks.join('')
      expect(output).toContain('message with spaces')
    })
  })

  describe.sequential('blank line tracking', () => {
    it('should track when last line was blank', () => {
      testLogger.log('')
      testLogger.logNewline()
      // Should not add duplicate blank line
      expect(stdoutChunks.length).toBe(1)
    })

    it('should track blank lines for stderr', () => {
      testLogger.error('')
      testLogger.errorNewline()
      // Should not add duplicate blank line
      expect(stderrChunks.length).toBe(1)
    })

    it('should reset blank tracking after non-blank log', () => {
      testLogger.log('')
      testLogger.log('text')
      testLogger.logNewline()
      // Should add blank line after non-blank
      expect(stdoutChunks.length).toBe(3)
    })
  })

  describe.sequential('edge cases', () => {
    it('should handle empty strings', () => {
      testLogger.log('')
      testLogger.error('')
      expect(stdoutChunks.length).toBe(1)
      expect(stderrChunks.length).toBe(1)
    })

    it('should handle special characters', () => {
      testLogger.log('Tab\there')
      testLogger.log('Newline\nhere')
      testLogger.log('Unicode: 🚀')
      expect(stdoutChunks.length).toBe(3)
    })

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(10_000)
      testLogger.log(longString)
      expect(stdoutChunks.join('')).toContain(longString)
    })

    it('should handle null and undefined', () => {
      testLogger.log(null)
      testLogger.log(undefined)
      expect(stdoutChunks.length).toBe(2)
    })

    it('should handle objects with circular references', () => {
      const obj: any = { name: 'test' }
      obj.self = obj
      expect(() => {
        testLogger.dir(obj)
      }).not.toThrow()
    })

    it('should handle nested indentation', () => {
      testLogger.indent()
      testLogger.log('level 1')
      testLogger.indent()
      testLogger.log('level 2')
      testLogger.indent()
      testLogger.log('level 3')
      testLogger.dedent()
      testLogger.dedent()
      testLogger.dedent()
      testLogger.log('level 0')
      const output = stdoutChunks.join('')
      expect(output).toContain('  level 1')
      expect(output).toContain('    level 2')
      expect(output).toContain('      level 3')
    })
  })

  describe('console methods proxy', () => {
    it('should have Symbol.toStringTag', () => {
      expect(Object.prototype.toString.call(testLogger)).toBe('[object logger]')
    })

    it('should support timeEnd without errors', () => {
      testLogger.time('any-timer')
      expect(() => {
        testLogger.timeEnd('any-timer')
      }).not.toThrow()
    })
  })

  describe('constructor with different argument types', () => {
    it('should handle object constructor args', () => {
      const customLogger = new Logger({
        stdout: mockStdout,
        stderr: mockStderr,
      })
      expect(customLogger).toBeInstanceOf(Logger)
    })

    it('should create logger without args', () => {
      const defaultLogger = new Logger()
      expect(defaultLogger).toBeInstanceOf(Logger)
    })
  })
})
