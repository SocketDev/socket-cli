/**
 * @fileoverview Console logging utilities with line prefix support.
 * Provides enhanced console methods with formatted output capabilities.
 */

import isUnicodeSupported from '@socketregistry/is-unicode-supported'
import yoctocolorsCjs from 'yoctocolors-cjs'
import { applyLinePrefix, isBlankString } from './strings'
import type { ColorValue } from './spinner'
import { getTheme, onThemeChange } from './themes/context'
import { THEMES } from './themes/themes'

/**
 * Log symbols for terminal output with colored indicators.
 *
 * Each symbol provides visual feedback for different message types, with
 * Unicode and ASCII fallback support.
 *
 * @example
 * ```typescript
 * import { LOG_SYMBOLS } from '@socketsecurity/lib'
 *
 * console.log(`${LOG_SYMBOLS.success} Operation completed`)
 * console.log(`${LOG_SYMBOLS.fail} Operation failed`)
 * console.log(`${LOG_SYMBOLS.warn} Warning message`)
 * console.log(`${LOG_SYMBOLS.info} Information message`)
 * console.log(`${LOG_SYMBOLS.step} Processing step`)
 * ```
 */
type LogSymbols = {
  /** Red colored failure symbol (✖ or × in ASCII) */
  fail: string
  /** Blue colored information symbol (ℹ or i in ASCII) */
  info: string
  /** Cyan colored step symbol (→ or > in ASCII) */
  step: string
  /** Green colored success symbol (✔ or √ in ASCII) */
  success: string
  /** Yellow colored warning symbol (⚠ or ‼ in ASCII) */
  warn: string
}

/**
 * Type definition for logger methods that mirror console methods.
 *
 * All methods return the logger instance for method chaining.
 */
type LoggerMethods = {
  [K in keyof typeof console]: (typeof console)[K] extends (
    ...args: infer A
  ) => any
    ? (...args: A) => Logger
    : (typeof console)[K]
}

/**
 * A task that can be executed with automatic start/complete logging.
 *
 * @example
 * ```typescript
 * const task = logger.createTask('Database migration')
 * task.run(() => {
 *   // Migration logic here
 * })
 * // Logs: "Starting task: Database migration"
 * // Logs: "Completed task: Database migration"
 * ```
 */
interface Task {
  /**
   * Executes the task function with automatic logging.
   *
   * @template T - The return type of the task function
   * @param f - The function to execute
   * @returns The result of the task function
   */
  run<T>(f: () => T): T
}

export type { LogSymbols, LoggerMethods, Task }

const globalConsole = console
// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ReflectApply = Reflect.apply
const ReflectConstruct = Reflect.construct

let _Console: typeof import('console').Console | undefined
/**
 * Construct a new Console instance.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function constructConsole(...args: unknown[]) {
  if (_Console === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    const nodeConsole = /*@__PURE__*/ require('node:console')
    _Console = nodeConsole.Console
  }
  return ReflectConstruct(
    _Console! as new (
      ...args: unknown[]
    ) => Console, // eslint-disable-line no-undef
    args,
  )
}

/**
 * Get the yoctocolors module for terminal colors.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getYoctocolors() {
  return yoctocolorsCjs
}

/**
 * Apply a color to text using yoctocolors.
 * Handles both named colors and RGB tuples.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function applyColor(
  text: string,
  color: ColorValue,
  colors: typeof yoctocolorsCjs,
): string {
  if (typeof color === 'string') {
    // Named color like 'green', 'red', etc.
    return (colors as any)[color](text)
  }
  // RGB tuple [r, g, b] - manually construct ANSI escape codes.
  // yoctocolors-cjs doesn't have an rgb() method, so we build it ourselves.
  const { 0: r, 1: g, 2: b } = color
  return `\u001B[38;2;${r};${g};${b}m${text}\u001B[39m`
}

/**
 * Log symbols for terminal output with colored indicators.
 *
 * Provides colored Unicode symbols (✔, ✖, ⚠, ℹ, →) with ASCII fallbacks (√, ×, ‼, i, >)
 * for terminals that don't support Unicode. Symbols are colored according to the active
 * theme's color palette (success, error, warning, info, step).
 *
 * The symbols are lazily initialized on first access and automatically update when the
 * fallback theme changes (via setTheme()). Note that LOG_SYMBOLS reflect the global
 * fallback theme, not async-local theme contexts from withTheme().
 *
 * @example
 * ```typescript
 * import { LOG_SYMBOLS } from '@socketsecurity/lib'
 *
 * console.log(`${LOG_SYMBOLS.success} Build completed`)    // Theme success color ✔
 * console.log(`${LOG_SYMBOLS.fail} Build failed`)          // Theme error color ✖
 * console.log(`${LOG_SYMBOLS.warn} Deprecated API used`)   // Theme warning color ⚠
 * console.log(`${LOG_SYMBOLS.info} Starting process`)      // Theme info color ℹ
 * console.log(`${LOG_SYMBOLS.step} Processing files`)      // Theme step color →
 * ```
 */
export const LOG_SYMBOLS = /*@__PURE__*/ (() => {
  const target: Record<string, string> = {
    __proto__: null,
  } as unknown as Record<string, string>

  let initialized = false

  // Mutable handler to simulate a frozen target.
  const handler: ProxyHandler<Record<string, string>> = {
    __proto__: null,
  } as unknown as ProxyHandler<Record<string, string>>

  const updateSymbols = () => {
    const supported = isUnicodeSupported()
    const colors = getYoctocolors()
    const theme = getTheme()

    // Get colors from theme
    const successColor = theme.colors.success
    const errorColor = theme.colors.error
    const warningColor = theme.colors.warning
    const infoColor = theme.colors.info
    const stepColor = theme.colors.step

    // Update symbol values
    target.fail = applyColor(supported ? '✖' : '×', errorColor, colors)
    target.info = applyColor(supported ? 'ℹ' : 'i', infoColor, colors)
    target.step = applyColor(supported ? '→' : '>', stepColor, colors)
    target.success = applyColor(supported ? '✔' : '√', successColor, colors)
    target.warn = applyColor(supported ? '⚠' : '‼', warningColor, colors)
  }

  const init = () => {
    if (initialized) {
      return
    }

    updateSymbols()
    initialized = true

    // The handler of a Proxy is mutable after proxy instantiation.
    // We delete the traps to defer to native behavior for better performance.
    for (const trapName in handler) {
      delete handler[trapName as keyof ProxyHandler<Record<string, string>>]
    }
  }

  const reset = () => {
    if (!initialized) {
      return
    }

    // Update symbols with new theme colors
    updateSymbols()
  }

  for (const trapName of Reflect.ownKeys(Reflect)) {
    const fn = (Reflect as Record<PropertyKey, unknown>)[trapName]
    if (typeof fn === 'function') {
      ;(handler as Record<string, (...args: unknown[]) => unknown>)[
        trapName as string
      ] = (...args: unknown[]) => {
        init()
        return fn(...args)
      }
    }
  }

  // Listen for theme changes and reset symbols
  onThemeChange(() => {
    reset()
  })

  return new Proxy(target, handler)
})()

const boundConsoleEntries = [
  // Add bound properties from console[kBindProperties](ignoreErrors, colorMode, groupIndentation).
  // https://github.com/nodejs/node/blob/v24.0.1/lib/internal/console/constructor.js#L230-L265
  '_stderrErrorHandler',
  '_stdoutErrorHandler',
  // Add methods that need to be bound to function properly.
  'assert',
  'clear',
  'count',
  'countReset',
  'createTask',
  'debug',
  'dir',
  'dirxml',
  'error',
  // Skip group methods because in at least Node 20 with the Node --frozen-intrinsics
  // flag it triggers a readonly property for Symbol(kGroupIndent). Instead, we
  // implement these methods ourselves.
  //'group',
  //'groupCollapsed',
  //'groupEnd',
  'info',
  'log',
  'table',
  'time',
  'timeEnd',
  'timeLog',
  'trace',
  'warn',
]
  .filter(n => typeof (globalConsole as any)[n] === 'function')
  .map(n => [n, (globalConsole as any)[n].bind(globalConsole)])

const consolePropAttributes = {
  __proto__: null,
  writable: true,
  enumerable: false,
  configurable: true,
}
const maxIndentation = 1000

/**
 * WeakMap storing the Console instance for each Logger.
 *
 * Console creation is lazy - deferred until first logging method call.
 * This allows logger to be imported during early Node.js bootstrap before
 * stdout is ready, avoiding ERR_CONSOLE_WRITABLE_STREAM errors.
 */
const privateConsole = new WeakMap()

/**
 * WeakMap storing constructor arguments for lazy Console initialization.
 *
 * WeakMap is required instead of a private field (#constructorArgs) because:
 * 1. Private fields can't be accessed from dynamically created functions
 * 2. Logger adds console methods dynamically to its prototype (lines 1560+)
 * 3. These dynamic methods need constructor args for lazy initialization
 * 4. WeakMap allows both regular methods and dynamic functions to access args
 *
 * The args are deleted from the WeakMap after Console is created (memory cleanup).
 */
const privateConstructorArgs = new WeakMap()

/**
 * Lazily get console symbols on first access.
 *
 * Deferred to avoid accessing global console during early Node.js bootstrap
 * before stdout is ready.
 * @private
 */
let _consoleSymbols: symbol[] | undefined
function getConsoleSymbols(): symbol[] {
  if (_consoleSymbols === undefined) {
    _consoleSymbols = Object.getOwnPropertySymbols(globalConsole)
  }
  return _consoleSymbols
}

/**
 * Symbol for incrementing the internal log call counter.
 *
 * This is an internal symbol used to track the number of times logging
 * methods have been called on a logger instance.
 */
export const incLogCallCountSymbol = Symbol.for('logger.logCallCount++')

/**
 * Lazily get kGroupIndentationWidth symbol on first access.
 * @private
 */
let _kGroupIndentationWidthSymbol: symbol | undefined
function getKGroupIndentationWidthSymbol(): symbol {
  if (_kGroupIndentationWidthSymbol === undefined) {
    _kGroupIndentationWidthSymbol =
      getConsoleSymbols().find(s => (s as any).label === 'kGroupIndentWidth') ??
      Symbol('kGroupIndentWidth')
  }
  return _kGroupIndentationWidthSymbol
}

/**
 * Symbol for tracking whether the last logged line was blank.
 *
 * This is used internally to prevent multiple consecutive blank lines
 * and to determine whether to add spacing before certain messages.
 */
export const lastWasBlankSymbol = Symbol.for('logger.lastWasBlank')

/**
 * Enhanced console logger with indentation, colored symbols, and stream management.
 *
 * Provides a fluent API for logging with automatic indentation tracking, colored
 * status symbols, separate stderr/stdout management, and method chaining. All
 * methods return `this` for easy chaining.
 *
 * Features:
 * - Automatic line prefixing with indentation
 * - Colored status symbols (success, fail, warn, info)
 * - Separate indentation tracking for stderr and stdout
 * - Stream-bound logger instances via `.stderr` and `.stdout`
 * - Group/indentation management
 * - Progress indicators with clearable lines
 * - Task execution with automatic logging
 *
 * @example
 * ```typescript
 * import { logger } from '@socketsecurity/lib'
 *
 * // Basic logging with symbols
 * logger.success('Build completed')
 * logger.fail('Build failed')
 * logger.warn('Deprecated API')
 * logger.info('Starting process')
 *
 * // Indentation and grouping
 * logger.log('Processing files:')
 * logger.indent()
 * logger.log('file1.js')
 * logger.log('file2.js')
 * logger.dedent()
 *
 * // Method chaining
 * logger
 *   .log('Step 1')
 *   .indent()
 *   .log('Substep 1.1')
 *   .log('Substep 1.2')
 *   .dedent()
 *   .log('Step 2')
 *
 * // Stream-specific logging
 * logger.stdout.log('Normal output')
 * logger.stderr.error('Error message')
 *
 * // Progress indicators
 * logger.progress('Processing...')
 * // ... do work ...
 * logger.clearLine()
 * logger.success('Done')
 *
 * // Task execution
 * const task = logger.createTask('Migration')
 * task.run(() => {
 *   // Migration logic
 * })
 * ```
 */
/*@__PURE__*/
export class Logger {
  /**
   * Static reference to log symbols for convenience.
   *
   * @example
   * ```typescript
   * console.log(`${Logger.LOG_SYMBOLS.success} Done`)
   * ```
   */
  static LOG_SYMBOLS = LOG_SYMBOLS

  #parent?: Logger
  #boundStream?: 'stderr' | 'stdout'
  #stderrLogger?: Logger
  #stdoutLogger?: Logger
  #stderrIndention = ''
  #stdoutIndention = ''
  #stderrLastWasBlank = false
  #stdoutLastWasBlank = false
  #logCallCount = 0
  #options: Record<string, unknown>
  #originalStdout?: any
  #theme?: import('./themes/types').Theme

  /**
   * Creates a new Logger instance.
   *
   * When called without arguments, creates a logger using the default
   * `process.stdout` and `process.stderr` streams. Can accept custom
   * console constructor arguments for advanced use cases.
   *
   * @param args - Optional console constructor arguments
   *
   * @example
   * ```typescript
   * // Default logger
   * const logger = new Logger()
   *
   * // Custom streams (advanced)
   * const customLogger = new Logger({
   *   stdout: customWritableStream,
   *   stderr: customErrorStream
   * })
   * ```
   */
  constructor(...args: unknown[]) {
    // Store constructor args for lazy Console initialization.
    privateConstructorArgs.set(this, args)

    // Store options if provided (for future extensibility)
    const options = args['0']
    if (typeof options === 'object' && options !== null) {
      this.#options = { __proto__: null, ...options }
      // Store reference to original stdout stream to bypass Console formatting
      this.#originalStdout = (options as any).stdout

      // Handle theme option
      const themeOption = (options as any).theme
      if (themeOption) {
        if (typeof themeOption === 'string') {
          // Theme name - resolve to Theme object
          this.#theme = THEMES[themeOption]
        } else {
          // Theme object
          this.#theme = themeOption
        }
      }
    } else {
      this.#options = { __proto__: null }
    }

    // Note: Console initialization is now lazy (happens on first use).
    // This allows logger to be imported during early bootstrap before
    // stdout is ready, avoiding ERR_CONSOLE_WRITABLE_STREAM errors.
  }

  /**
   * Get the Console instance for this logger, creating it lazily on first access.
   *
   * This lazy initialization allows the logger to be imported during early
   * Node.js bootstrap before stdout is ready, avoiding Console initialization
   * errors (ERR_CONSOLE_WRITABLE_STREAM).
   *
   * @private
   */
  #getConsole(): typeof console & Record<string, unknown> {
    // Ensure prototype is initialized before creating Console.
    ensurePrototypeInitialized()

    let con = privateConsole.get(this)
    if (!con) {
      // Lazy initialization - create Console on first use.
      const ctorArgs = privateConstructorArgs.get(this) ?? []
      if (ctorArgs.length) {
        con = constructConsole(...ctorArgs)
      } else {
        // Create a new console that acts like the builtin one so that it will
        // work with Node's --frozen-intrinsics flag.
        con = constructConsole({
          stdout: process.stdout,
          stderr: process.stderr,
        }) as typeof console & Record<string, unknown>
        for (const { 0: key, 1: method } of boundConsoleEntries) {
          con[key] = method
        }
      }
      privateConsole.set(this, con)
      // Clean up constructor args - no longer needed after Console creation.
      privateConstructorArgs.delete(this)
    }
    return con
  }

  /**
   * Gets a logger instance bound exclusively to stderr.
   *
   * All logging operations on this instance will write to stderr only.
   * Indentation is tracked separately from stdout. The instance is
   * cached and reused on subsequent accesses.
   *
   * @returns A logger instance bound to stderr
   *
   * @example
   * ```typescript
   * // Write errors to stderr
   * logger.stderr.error('Configuration invalid')
   * logger.stderr.warn('Using fallback settings')
   *
   * // Indent only affects stderr
   * logger.stderr.indent()
   * logger.stderr.error('Nested error details')
   * logger.stderr.dedent()
   * ```
   */
  get stderr(): Logger {
    if (!this.#stderrLogger) {
      // Pass parent's constructor args to maintain config.
      const ctorArgs = privateConstructorArgs.get(this) ?? []
      const instance = new Logger(...ctorArgs)
      instance.#parent = this
      instance.#boundStream = 'stderr'
      instance.#options = { __proto__: null, ...this.#options }
      instance.#theme = this.#theme
      this.#stderrLogger = instance
    }
    return this.#stderrLogger
  }

  /**
   * Gets a logger instance bound exclusively to stdout.
   *
   * All logging operations on this instance will write to stdout only.
   * Indentation is tracked separately from stderr. The instance is
   * cached and reused on subsequent accesses.
   *
   * @returns A logger instance bound to stdout
   *
   * @example
   * ```typescript
   * // Write normal output to stdout
   * logger.stdout.log('Processing started')
   * logger.stdout.log('Items processed: 42')
   *
   * // Indent only affects stdout
   * logger.stdout.indent()
   * logger.stdout.log('Detailed output')
   * logger.stdout.dedent()
   * ```
   */
  get stdout(): Logger {
    if (!this.#stdoutLogger) {
      // Pass parent's constructor args to maintain config.
      const ctorArgs = privateConstructorArgs.get(this) ?? []
      const instance = new Logger(...ctorArgs)
      instance.#parent = this
      instance.#boundStream = 'stdout'
      instance.#options = { __proto__: null, ...this.#options }
      instance.#theme = this.#theme
      this.#stdoutLogger = instance
    }
    return this.#stdoutLogger
  }

  /**
   * Get the root logger (for accessing shared indentation state).
   * @private
   */
  #getRoot(): Logger {
    return this.#parent || this
  }

  /**
   * Get the resolved theme for this logger instance.
   * Returns instance theme if set, otherwise falls back to context theme.
   * @private
   */
  #getTheme(): import('./themes/types').Theme {
    return this.#theme ?? getTheme()
  }

  /**
   * Get logger-specific symbols using the resolved theme.
   * @private
   */
  #getSymbols(): LogSymbols {
    const theme = this.#getTheme()
    const supported = isUnicodeSupported()
    const colors = getYoctocolors()

    return {
      __proto__: null,
      fail: applyColor(supported ? '✖' : '×', theme.colors.error, colors),
      info: applyColor(supported ? 'ℹ' : 'i', theme.colors.info, colors),
      step: applyColor(supported ? '→' : '>', theme.colors.step, colors),
      success: applyColor(supported ? '✔' : '√', theme.colors.success, colors),
      warn: applyColor(supported ? '⚠' : '‼', theme.colors.warning, colors),
    } as LogSymbols
  }

  /**
   * Get indentation for a specific stream.
   * @private
   */
  #getIndent(stream: 'stderr' | 'stdout'): string {
    const root = this.#getRoot()
    return stream === 'stderr' ? root.#stderrIndention : root.#stdoutIndention
  }

  /**
   * Set indentation for a specific stream.
   * @private
   */
  #setIndent(stream: 'stderr' | 'stdout', value: string): void {
    const root = this.#getRoot()
    if (stream === 'stderr') {
      root.#stderrIndention = value
    } else {
      root.#stdoutIndention = value
    }
  }

  /**
   * Get lastWasBlank state for a specific stream.
   * @private
   */
  #getLastWasBlank(stream: 'stderr' | 'stdout'): boolean {
    const root = this.#getRoot()
    return stream === 'stderr'
      ? root.#stderrLastWasBlank
      : root.#stdoutLastWasBlank
  }

  /**
   * Set lastWasBlank state for a specific stream.
   * @private
   */
  #setLastWasBlank(stream: 'stderr' | 'stdout', value: boolean): void {
    const root = this.#getRoot()
    if (stream === 'stderr') {
      root.#stderrLastWasBlank = value
    } else {
      root.#stdoutLastWasBlank = value
    }
  }

  /**
   * Get the target stream for this logger instance.
   * @private
   */
  #getTargetStream(): 'stderr' | 'stdout' {
    return this.#boundStream || 'stderr'
  }

  /**
   * Apply a console method with indentation.
   * @private
   */
  #apply(
    methodName: string,
    args: unknown[],
    stream?: 'stderr' | 'stdout',
  ): this {
    const con = this.#getConsole()
    const text = args.at(0)
    const hasText = typeof text === 'string'
    // Determine which stream this method writes to
    const targetStream = stream || (methodName === 'log' ? 'stdout' : 'stderr')
    const indent = this.#getIndent(targetStream)
    const logArgs = hasText
      ? [applyLinePrefix(text, { prefix: indent }), ...args.slice(1)]
      : args
    ReflectApply(
      con[methodName] as (...args: unknown[]) => unknown,
      con,
      logArgs,
    )
    this[lastWasBlankSymbol](hasText && isBlankString(logArgs[0]), targetStream)
    ;(this as any)[incLogCallCountSymbol]()
    return this
  }

  /**
   * Strip log symbols from the start of text.
   * @private
   */
  #stripSymbols(text: string): string {
    // Strip both unicode and emoji forms of log symbols from the start.
    // Matches: ✖, ✗, ×, ✖️, ⚠, ‼, ⚠️, ✔, ✓, √, ✔️, ✓️, ℹ, ℹ️, →, >
    // Also handles variation selectors (U+FE0F) and whitespace after symbol.
    // Note: We don't strip standalone 'i' or '>' to avoid breaking words.
    return text.replace(/^[✖✗×⚠‼✔✓√ℹ→]\uFE0F?\s*/u, '')
  }

  /**
   * Apply a method with a symbol prefix.
   * @private
   */
  #symbolApply(symbolType: string, args: unknown[]): this {
    const con = this.#getConsole()
    let text = args.at(0)
    // biome-ignore lint/suspicious/noImplicitAnyLet: Flexible argument handling.
    let extras
    if (typeof text === 'string') {
      text = this.#stripSymbols(text)
      extras = args.slice(1)
    } else {
      extras = args
      text = ''
    }
    // Note: Meta status messages (info/fail/etc) always go to stderr.
    const indent = this.#getIndent('stderr')
    const symbols = this.#getSymbols()
    con.error(
      applyLinePrefix(`${symbols[symbolType]} ${text}`, {
        prefix: indent,
      }),
      ...extras,
    )
    this[lastWasBlankSymbol](false, 'stderr')
    ;(this as any)[incLogCallCountSymbol]()
    return this
  }

  /**
   * Gets the total number of log calls made on this logger instance.
   *
   * Tracks all logging method calls including `log()`, `error()`, `warn()`,
   * `success()`, `fail()`, etc. Useful for testing and monitoring logging activity.
   *
   * @returns The number of times logging methods have been called
   *
   * @example
   * ```typescript
   * logger.log('Message 1')
   * logger.error('Message 2')
   * console.log(logger.logCallCount) // 2
   * ```
   */
  get logCallCount() {
    const root = this.#getRoot()
    return root.#logCallCount
  }

  /**
   * Increments the internal log call counter.
   *
   * This is called automatically by logging methods and should not
   * be called directly in normal usage.
   *
   * @returns The logger instance for chaining
   */
  [incLogCallCountSymbol]() {
    const root = this.#getRoot()
    root.#logCallCount += 1
    return this
  }

  /**
   * Sets whether the last logged line was blank.
   *
   * Used internally to track blank lines and prevent duplicate spacing.
   * This is called automatically by logging methods.
   *
   * @param value - Whether the last line was blank
   * @param stream - Optional stream to update (defaults to both streams if not bound, or target stream if bound)
   * @returns The logger instance for chaining
   */
  [lastWasBlankSymbol](value: unknown, stream?: 'stderr' | 'stdout'): this {
    if (stream) {
      // Explicit stream specified
      this.#setLastWasBlank(stream, !!value)
    } else if (this.#boundStream) {
      // Stream-bound logger - affect only the bound stream
      this.#setLastWasBlank(this.#boundStream, !!value)
    } else {
      // Root logger with no stream specified - affect both streams
      this.#setLastWasBlank('stderr', !!value)
      this.#setLastWasBlank('stdout', !!value)
    }
    return this
  }

  /**
   * Logs an assertion failure message if the value is falsy.
   *
   * Works like `console.assert()` but returns the logger for chaining.
   * If the value is truthy, nothing is logged. If falsy, logs an error
   * message with an assertion failure.
   *
   * @param value - The value to test
   * @param message - Optional message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.assert(true, 'This will not log')
   * logger.assert(false, 'Assertion failed: value is false')
   * logger.assert(items.length > 0, 'No items found')
   * ```
   */
  assert(value: unknown, ...message: unknown[]): this {
    const con = this.#getConsole()
    con.assert(value, message[0] as string, ...message.slice(1))
    this[lastWasBlankSymbol](false)
    return value ? this : this[incLogCallCountSymbol]()
  }

  /**
   * Clears the visible terminal screen.
   *
   * Only available on the main logger instance, not on stream-bound instances
   * (`.stderr` or `.stdout`). Resets the log call count and blank line tracking
   * if the output is a TTY.
   *
   * @returns The logger instance for chaining
   * @throws {Error} If called on a stream-bound logger instance
   *
   * @example
   * ```typescript
   * logger.log('Some output')
   * logger.clearVisible()  // Screen is now clear
   *
   * // Error: Can't call on stream-bound instance
   * logger.stderr.clearVisible()  // throws
   * ```
   */
  clearVisible() {
    if (this.#boundStream) {
      throw new Error(
        'clearVisible() is only available on the main logger instance, not on stream-bound instances',
      )
    }
    const con = this.#getConsole()
    con.clear()
    if ((con as any)._stdout.isTTY) {
      ;(this as any)[lastWasBlankSymbol](true)
      this.#logCallCount = 0
    }
    return this
  }

  /**
   * Increments and logs a counter for the given label.
   *
   * Each unique label maintains its own counter. Works like `console.count()`.
   *
   * @param label - Optional label for the counter
   * @default 'default'
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.count('requests')  // requests: 1
   * logger.count('requests')  // requests: 2
   * logger.count('errors')    // errors: 1
   * logger.count()            // default: 1
   * ```
   */
  count(label?: string | undefined): this {
    const con = this.#getConsole()
    con.count(label)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Creates a task that logs start and completion messages automatically.
   *
   * Returns a task object with a `run()` method that executes the provided
   * function and logs "Starting task: {name}" before execution and
   * "Completed task: {name}" after completion.
   *
   * @param name - The name of the task
   * @returns A task object with a `run()` method
   *
   * @example
   * ```typescript
   * const task = logger.createTask('Database Migration')
   * const result = task.run(() => {
   *   // Logs: "Starting task: Database Migration"
   *   migrateDatabase()
   *   return 'success'
   *   // Logs: "Completed task: Database Migration"
   * })
   * console.log(result)  // 'success'
   * ```
   */
  createTask(name: string): Task {
    return {
      run: <T>(f: () => T): T => {
        this.log(`Starting task: ${name}`)
        const result = f()
        this.log(`Completed task: ${name}`)
        return result
      },
    }
  }

  /**
   * Decreases the indentation level by removing spaces from the prefix.
   *
   * When called on the main logger, affects both stderr and stdout indentation.
   * When called on a stream-bound logger (`.stderr` or `.stdout`), affects
   * only that stream's indentation.
   *
   * @param spaces - Number of spaces to remove from indentation
   * @default 2
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.indent()
   * logger.log('Indented')
   * logger.dedent()
   * logger.log('Back to normal')
   *
   * // Remove custom amount
   * logger.indent(4)
   * logger.log('Four spaces')
   * logger.dedent(4)
   *
   * // Stream-specific dedent
   * logger.stdout.indent()
   * logger.stdout.log('Indented stdout')
   * logger.stdout.dedent()
   * ```
   */
  dedent(spaces = 2) {
    if (this.#boundStream) {
      // Only affect bound stream
      const current = this.#getIndent(this.#boundStream)
      this.#setIndent(this.#boundStream, current.slice(0, -spaces))
    } else {
      // Affect both streams
      const stderrCurrent = this.#getIndent('stderr')
      const stdoutCurrent = this.#getIndent('stdout')
      this.#setIndent('stderr', stderrCurrent.slice(0, -spaces))
      this.#setIndent('stdout', stdoutCurrent.slice(0, -spaces))
    }
    return this
  }

  /**
   * Displays an object's properties in a formatted way.
   *
   * Works like `console.dir()` with customizable options for depth,
   * colors, etc. Useful for inspecting complex objects.
   *
   * @param obj - The object to display
   * @param options - Optional formatting options (Node.js inspect options)
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * const obj = { a: 1, b: { c: 2, d: { e: 3 } } }
   * logger.dir(obj)
   * logger.dir(obj, { depth: 1 })  // Limit nesting depth
   * logger.dir(obj, { colors: true })  // Enable colors
   * ```
   */
  dir(obj: unknown, options?: unknown | undefined): this {
    const con = this.#getConsole()
    con.dir(obj, options)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Displays data as XML/HTML in a formatted way.
   *
   * Works like `console.dirxml()`. In Node.js, behaves the same as `dir()`.
   *
   * @param data - The data to display
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.dirxml(document.body)  // In browser environments
   * logger.dirxml(xmlObject)       // In Node.js
   * ```
   */
  dirxml(...data: unknown[]): this {
    const con = this.#getConsole()
    con.dirxml(data)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Logs an error message to stderr.
   *
   * Automatically applies current indentation. All arguments are formatted
   * and logged like `console.error()`.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.error('Build failed')
   * logger.error('Error code:', 500)
   * logger.error('Details:', { message: 'Not found' })
   * ```
   */
  error(...args: unknown[]): this {
    return this.#apply('error', args)
  }

  /**
   * Logs a newline to stderr only if the last line wasn't already blank.
   *
   * Prevents multiple consecutive blank lines. Useful for adding spacing
   * between sections without creating excessive whitespace.
   *
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.error('Error message')
   * logger.errorNewline()  // Adds blank line
   * logger.errorNewline()  // Does nothing (already blank)
   * logger.error('Next section')
   * ```
   */
  errorNewline() {
    return this.#getLastWasBlank('stderr') ? this : this.error('')
  }

  /**
   * Logs a failure message with a red colored fail symbol.
   *
   * Automatically prefixes the message with `LOG_SYMBOLS.fail` (red ✖).
   * Always outputs to stderr. If the message starts with an existing
   * symbol, it will be stripped and replaced.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.fail('Build failed')
   * logger.fail('Test suite failed:', { passed: 5, failed: 3 })
   * ```
   */
  fail(...args: unknown[]): this {
    return this.#symbolApply('fail', args)
  }

  /**
   * Starts a new indented log group.
   *
   * If a label is provided, it's logged before increasing indentation.
   * Groups can be nested. Each group increases indentation by the
   * `kGroupIndentWidth` (default 2 spaces). Call `groupEnd()` to close.
   *
   * @param label - Optional label to display before the group
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.group('Processing files:')
   * logger.log('file1.js')
   * logger.log('file2.js')
   * logger.groupEnd()
   *
   * // Nested groups
   * logger.group('Outer')
   * logger.log('Outer content')
   * logger.group('Inner')
   * logger.log('Inner content')
   * logger.groupEnd()
   * logger.groupEnd()
   * ```
   */
  group(...label: unknown[]): this {
    const { length } = label
    if (length) {
      ReflectApply(this.log, this, label)
    }
    this.indent((this as any)[getKGroupIndentationWidthSymbol()])
    if (length) {
      ;(this as any)[lastWasBlankSymbol](false)
      ;(this as any)[incLogCallCountSymbol]()
    }
    return this
  }

  /**
   * Starts a new collapsed log group (alias for `group()`).
   *
   * In browser consoles, this creates a collapsed group. In Node.js,
   * it behaves identically to `group()`.
   *
   * @param label - Optional label to display before the group
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.groupCollapsed('Details')
   * logger.log('Hidden by default in browsers')
   * logger.groupEnd()
   * ```
   */
  // groupCollapsed is an alias of group.
  // https://nodejs.org/api/console.html#consolegroupcollapsed
  groupCollapsed(...label: unknown[]): this {
    return ReflectApply(this.group, this, label)
  }

  /**
   * Ends the current log group and decreases indentation.
   *
   * Must be called once for each `group()` or `groupCollapsed()` call
   * to properly close the group and restore indentation.
   *
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.group('Group 1')
   * logger.log('Content')
   * logger.groupEnd()  // Closes 'Group 1'
   * ```
   */
  groupEnd() {
    this.dedent((this as any)[getKGroupIndentationWidthSymbol()])
    return this
  }

  /**
   * Increases the indentation level by adding spaces to the prefix.
   *
   * When called on the main logger, affects both stderr and stdout indentation.
   * When called on a stream-bound logger (`.stderr` or `.stdout`), affects
   * only that stream's indentation. Maximum indentation is 1000 spaces.
   *
   * @param spaces - Number of spaces to add to indentation
   * @default 2
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.log('Level 0')
   * logger.indent()
   * logger.log('Level 1')
   * logger.indent()
   * logger.log('Level 2')
   * logger.dedent()
   * logger.dedent()
   *
   * // Custom indent amount
   * logger.indent(4)
   * logger.log('Indented 4 spaces')
   * logger.dedent(4)
   *
   * // Stream-specific indent
   * logger.stdout.indent()
   * logger.stdout.log('Only stdout is indented')
   * ```
   */
  indent(spaces = 2) {
    const spacesToAdd = ' '.repeat(Math.min(spaces, maxIndentation))
    if (this.#boundStream) {
      // Only affect bound stream
      const current = this.#getIndent(this.#boundStream)
      this.#setIndent(this.#boundStream, current + spacesToAdd)
    } else {
      // Affect both streams
      const stderrCurrent = this.#getIndent('stderr')
      const stdoutCurrent = this.#getIndent('stdout')
      this.#setIndent('stderr', stderrCurrent + spacesToAdd)
      this.#setIndent('stdout', stdoutCurrent + spacesToAdd)
    }
    return this
  }

  /**
   * Logs an informational message with a blue colored info symbol.
   *
   * Automatically prefixes the message with `LOG_SYMBOLS.info` (blue ℹ).
   * Always outputs to stderr. If the message starts with an existing
   * symbol, it will be stripped and replaced.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.info('Starting build process')
   * logger.info('Configuration loaded:', config)
   * logger.info('Using cache directory:', cacheDir)
   * ```
   */
  info(...args: unknown[]): this {
    return this.#symbolApply('info', args)
  }

  /**
   * Logs a message to stdout.
   *
   * Automatically applies current indentation. All arguments are formatted
   * and logged like `console.log()`. This is the primary method for
   * standard output.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.log('Processing complete')
   * logger.log('Items processed:', 42)
   * logger.log('Results:', { success: true, count: 10 })
   *
   * // Method chaining
   * logger.log('Step 1').log('Step 2').log('Step 3')
   * ```
   */
  log(...args: unknown[]): this {
    return this.#apply('log', args)
  }

  /**
   * Logs a newline to stdout only if the last line wasn't already blank.
   *
   * Prevents multiple consecutive blank lines. Useful for adding spacing
   * between sections without creating excessive whitespace.
   *
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.log('Section 1')
   * logger.logNewline()  // Adds blank line
   * logger.logNewline()  // Does nothing (already blank)
   * logger.log('Section 2')
   * ```
   */
  logNewline() {
    return this.#getLastWasBlank('stdout') ? this : this.log('')
  }

  /**
   * Resets all indentation to zero.
   *
   * When called on the main logger, resets both stderr and stdout indentation.
   * When called on a stream-bound logger (`.stderr` or `.stdout`), resets
   * only that stream's indentation.
   *
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.indent().indent().indent()
   * logger.log('Very indented')
   * logger.resetIndent()
   * logger.log('Back to zero indentation')
   *
   * // Reset only stdout
   * logger.stdout.resetIndent()
   * ```
   */
  resetIndent() {
    if (this.#boundStream) {
      // Only reset bound stream
      this.#setIndent(this.#boundStream, '')
    } else {
      // Reset both streams
      this.#setIndent('stderr', '')
      this.#setIndent('stdout', '')
    }
    return this
  }

  /**
   * Logs a main step message with a cyan arrow symbol and blank line before it.
   *
   * Automatically prefixes the message with `LOG_SYMBOLS.step` (cyan →) and
   * adds a blank line before the message unless the last line was already blank.
   * Useful for marking major steps in a process with clear visual separation.
   * Always outputs to stdout. If the message starts with an existing symbol,
   * it will be stripped and replaced.
   *
   * @param msg - The step message to log
   * @param extras - Additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.step('Building project')
   * logger.log('Compiling TypeScript...')
   * logger.step('Running tests')
   * logger.log('Running test suite...')
   * // Output:
   * // [blank line]
   * // → Building project
   * // Compiling TypeScript...
   * // [blank line]
   * // → Running tests
   * // Running test suite...
   * ```
   */
  step(msg: string, ...extras: unknown[]): this {
    // Add blank line before the step message.
    if (!this.#getLastWasBlank('stdout')) {
      // Use this.log() to properly track the blank line.
      this.log('')
    }
    // Strip existing symbols from the message.
    const text = this.#stripSymbols(msg)
    // Note: Step messages always go to stdout (unlike info/fail/etc which go to stderr).
    const indent = this.#getIndent('stdout')
    const symbols = this.#getSymbols()
    const con = this.#getConsole() as typeof console & Record<string, unknown>
    con.log(
      applyLinePrefix(`${symbols.step} ${text}`, {
        prefix: indent,
      }),
      ...extras,
    )
    this[lastWasBlankSymbol](false, 'stdout')
    ;(this as any)[incLogCallCountSymbol]()
    return this
  }

  /**
   * Logs an indented substep message (stateless).
   *
   * Adds a 2-space indent to the message without affecting the logger's
   * indentation state. Useful for showing sub-items under a main step.
   *
   * @param msg - The substep message to log
   * @param extras - Additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.log('Installing dependencies:')
   * logger.substep('Installing react')
   * logger.substep('Installing typescript')
   * logger.substep('Installing eslint')
   * // Output:
   * // Installing dependencies:
   * //   Installing react
   * //   Installing typescript
   * //   Installing eslint
   * ```
   */
  substep(msg: string, ...extras: unknown[]): this {
    // Add 2-space indent to the message.
    const indentedMsg = `  ${msg}`
    // Let log() handle all tracking.
    return this.log(indentedMsg, ...extras)
  }

  /**
   * Logs a success message with a green colored success symbol.
   *
   * Automatically prefixes the message with `LOG_SYMBOLS.success` (green ✔).
   * Always outputs to stderr. If the message starts with an existing
   * symbol, it will be stripped and replaced.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.success('Build completed')
   * logger.success('Tests passed:', { total: 42, passed: 42 })
   * logger.success('Deployment successful')
   * ```
   */
  success(...args: unknown[]): this {
    return this.#symbolApply('success', args)
  }

  /**
   * Logs a completion message with a success symbol (alias for `success()`).
   *
   * Provides semantic clarity when marking something as "done". Does NOT
   * automatically clear the current line - call `clearLine()` first if
   * needed after using `progress()`.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.done('Task completed')
   *
   * // After progress indicator
   * logger.progress('Processing...')
   * // ... do work ...
   * logger.clearLine()
   * logger.done('Processing complete')
   * ```
   */
  done(...args: unknown[]): this {
    return this.#symbolApply('success', args)
  }

  /**
   * Displays data in a table format.
   *
   * Works like `console.table()`. Accepts arrays of objects or
   * objects with nested objects. Optionally specify which properties
   * to include in the table.
   *
   * @param tabularData - The data to display as a table
   * @param properties - Optional array of property names to include
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * // Array of objects
   * logger.table([
   *   { name: 'Alice', age: 30 },
   *   { name: 'Bob', age: 25 }
   * ])
   *
   * // Specify properties to show
   * logger.table(users, ['name', 'email'])
   *
   * // Object with nested objects
   * logger.table({
   *   user1: { name: 'Alice', age: 30 },
   *   user2: { name: 'Bob', age: 25 }
   * })
   * ```
   */
  table(
    tabularData: unknown,
    properties?: readonly string[] | undefined,
  ): this {
    const con = this.#getConsole()
    con.table(tabularData, properties)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Starts a timer for measuring elapsed time.
   *
   * Creates a timer with the given label. Use `timeEnd()` with the same
   * label to stop the timer and log the elapsed time, or use `timeLog()`
   * to check the time without stopping the timer.
   *
   * @param label - Optional label for the timer
   * @default 'default'
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.time('operation')
   * // ... do work ...
   * logger.timeEnd('operation')
   * // Logs: "operation: 123.456ms"
   *
   * logger.time()
   * // ... do work ...
   * logger.timeEnd()
   * // Logs: "default: 123.456ms"
   * ```
   */
  time(label?: string | undefined): this {
    const con = this.#getConsole()
    con.time(label)
    return this
  }

  /**
   * Ends a timer and logs the elapsed time.
   *
   * Logs the duration since `console.time()` or `logger.time()` was called
   * with the same label. The timer is stopped and removed.
   *
   * @param label - Optional label for the timer
   * @default 'default'
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.time('operation')
   * // ... do work ...
   * logger.timeEnd('operation')
   * // Logs: "operation: 123.456ms"
   *
   * logger.time()
   * // ... do work ...
   * logger.timeEnd()
   * // Logs: "default: 123.456ms"
   * ```
   */
  timeEnd(label?: string | undefined): this {
    const con = this.#getConsole()
    con.timeEnd(label)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Logs the current value of a timer without stopping it.
   *
   * Logs the duration since `console.time()` was called with the same
   * label, but keeps the timer running. Can include additional data
   * to log alongside the time.
   *
   * @param label - Optional label for the timer
   * @param data - Additional data to log with the time
   * @default 'default'
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * console.time('process')
   * // ... partial work ...
   * logger.timeLog('process', 'Checkpoint 1')
   * // Logs: "process: 123.456ms Checkpoint 1"
   * // ... more work ...
   * logger.timeLog('process', 'Checkpoint 2')
   * // Logs: "process: 234.567ms Checkpoint 2"
   * console.timeEnd('process')
   * ```
   */
  timeLog(label?: string | undefined, ...data: unknown[]): this {
    const con = this.#getConsole()
    con.timeLog(label, ...data)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Logs a stack trace to the console.
   *
   * Works like `console.trace()`. Shows the call stack leading to
   * where this method was called. Useful for debugging.
   *
   * @param message - Optional message to display with the trace
   * @param args - Additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * function debugFunction() {
   *   logger.trace('Debug point reached')
   * }
   *
   * logger.trace('Trace from here')
   * logger.trace('Error context:', { userId: 123 })
   * ```
   */
  trace(message?: unknown | undefined, ...args: unknown[]): this {
    const con = this.#getConsole()
    con.trace(message, ...args)
    this[lastWasBlankSymbol](false)
    return this[incLogCallCountSymbol]()
  }

  /**
   * Logs a warning message with a yellow colored warning symbol.
   *
   * Automatically prefixes the message with `LOG_SYMBOLS.warn` (yellow ⚠).
   * Always outputs to stderr. If the message starts with an existing
   * symbol, it will be stripped and replaced.
   *
   * @param args - Message and additional arguments to log
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.warn('Deprecated API used')
   * logger.warn('Low memory:', { available: '100MB' })
   * logger.warn('Missing optional configuration')
   * ```
   */
  warn(...args: unknown[]): this {
    return this.#symbolApply('warn', args)
  }

  /**
   * Writes text directly to stdout without a newline or indentation.
   *
   * Useful for progress indicators or custom formatting where you need
   * low-level control. Does not apply any indentation or formatting.
   *
   * @param text - The text to write
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.write('Processing... ')
   * // ... do work ...
   * logger.write('done\n')
   *
   * // Build a line incrementally
   * logger.write('Step 1')
   * logger.write('... Step 2')
   * logger.write('... Step 3\n')
   * ```
   */
  write(text: string): this {
    const con = this.#getConsole()
    // Write directly to the original stdout stream to bypass Console formatting
    // (e.g., group indentation). Try multiple approaches to get the raw stream:
    // 1. Use stored reference from constructor options
    // 2. Try to get from constructor args
    // 3. Fall back to con._stdout (which applies formatting)
    const ctorArgs = privateConstructorArgs.get(this) ?? []
    const stdout =
      this.#originalStdout || (ctorArgs[0] as any)?.stdout || con._stdout
    stdout.write(text)
    this[lastWasBlankSymbol](false)
    return this
  }

  /**
   * Shows a progress indicator that can be cleared with `clearLine()`.
   *
   * Displays a simple status message with a '∴' prefix. Does not include
   * animation or spinner. Intended to be cleared once the operation completes.
   * The output stream (stderr or stdout) depends on whether the logger is
   * stream-bound.
   *
   * @param text - The progress message to display
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.progress('Processing files...')
   * // ... do work ...
   * logger.clearLine()
   * logger.success('Files processed')
   *
   * // Stream-specific progress
   * logger.stdout.progress('Loading...')
   * // ... do work ...
   * logger.stdout.clearLine()
   * logger.stdout.log('Done')
   * ```
   */
  progress(text: string): this {
    const con = this.#getConsole()
    const stream = this.#getTargetStream()
    const streamObj = (
      stream === 'stderr' ? con._stderr : con._stdout
    ) as NodeJS.WriteStream & { write: (text: string) => boolean }
    streamObj.write(`∴ ${text}`)
    this[lastWasBlankSymbol](false)
    return this
  }

  /**
   * Clears the current line in the terminal.
   *
   * Moves the cursor to the beginning of the line and clears all content.
   * Works in both TTY and non-TTY environments. Useful for clearing
   * progress indicators created with `progress()`.
   *
   * The stream to clear (stderr or stdout) depends on whether the logger
   * is stream-bound.
   *
   * @returns The logger instance for chaining
   *
   * @example
   * ```typescript
   * logger.progress('Loading...')
   * // ... do work ...
   * logger.clearLine()
   * logger.success('Loaded')
   *
   * // Clear multiple progress updates
   * for (const file of files) {
   *   logger.progress(`Processing ${file}`)
   *   processFile(file)
   *   logger.clearLine()
   * }
   * logger.success('All files processed')
   * ```
   */
  clearLine(): this {
    const con = this.#getConsole()
    const stream = this.#getTargetStream()
    const streamObj = (
      stream === 'stderr' ? con._stderr : con._stdout
    ) as NodeJS.WriteStream & {
      isTTY: boolean
      cursorTo: (x: number) => void
      clearLine: (dir: number) => void
      write: (text: string) => boolean
    }
    if (streamObj.isTTY) {
      streamObj.cursorTo(0)
      streamObj.clearLine(0)
    } else {
      streamObj.write('\r\x1b[K')
    }
    return this
  }
}

/**
 * Lazily add dynamic console methods to Logger prototype.
 *
 * This is deferred until first access to avoid calling Object.entries(globalConsole)
 * during early Node.js bootstrap before stdout is ready.
 * @private
 */
let _prototypeInitialized = false
function ensurePrototypeInitialized() {
  if (_prototypeInitialized) {
    return
  }
  _prototypeInitialized = true

  const entries: Array<[string | symbol, PropertyDescriptor]> = [
    [
      getKGroupIndentationWidthSymbol(),
      {
        ...consolePropAttributes,
        value: 2,
      },
    ],
    [
      Symbol.toStringTag,
      {
        __proto__: null,
        configurable: true,
        value: 'logger',
      } as PropertyDescriptor,
    ],
  ]
  for (const { 0: key, 1: value } of Object.entries(globalConsole)) {
    if (!(Logger.prototype as any)[key] && typeof value === 'function') {
      // Dynamically name the log method without using Object.defineProperty.
      const { [key]: func } = {
        [key](this: Logger, ...args: unknown[]) {
          // Access Console via WeakMap directly since private methods can't be
          // called from dynamically created functions.
          let con = privateConsole.get(this)
          if (con === undefined) {
            // Lazy initialization - this will only happen if someone calls a
            // dynamically added console method before any core logger method.
            const ctorArgs = privateConstructorArgs.get(this) ?? []
            // Clean up constructor args - no longer needed after Console creation.
            privateConstructorArgs.delete(this)
            if (ctorArgs.length) {
              con = constructConsole(...ctorArgs)
            } else {
              con = constructConsole({
                stdout: process.stdout,
                stderr: process.stderr,
              }) as typeof console & Record<string, unknown>
              for (const { 0: k, 1: method } of boundConsoleEntries) {
                con[k] = method
              }
            }
            privateConsole.set(this, con)
          }
          const result = (con as any)[key](...args)
          return result === undefined || result === con ? this : result
        },
      }
      entries.push([
        key,
        {
          ...consolePropAttributes,
          value: func,
        },
      ])
    }
  }
  Object.defineProperties(Logger.prototype, Object.fromEntries(entries))
}

// Private singleton instance
let _logger: Logger | undefined

/**
 * Get the default logger instance.
 * Lazily creates the logger to avoid circular dependencies during module initialization.
 * Reuses the same instance across calls.
 *
 * @returns Shared default logger instance
 *
 * @example
 * ```ts
 * import { getDefaultLogger } from '@socketsecurity/lib/logger'
 *
 * const logger = getDefaultLogger()
 * logger.log('Application started')
 * logger.success('Configuration loaded')
 * ```
 */
export function getDefaultLogger(): Logger {
  if (_logger === undefined) {
    _logger = new Logger()
  }
  return _logger
}

// REMOVED: Deprecated `logger` export
// Migration: Use getDefaultLogger() instead
// See: getDefaultLogger() function above
