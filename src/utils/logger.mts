/*
 * Adapted narrowly from @socketsecurity/registry 1.1.17, lib/logger.js.
 * Copyright (c) 2024 Socket Inc. Licensed under the MIT License.
 */

import { Console } from 'node:console'
import { Writable } from 'node:stream'

import colors from 'yoctocolors-cjs'

const isBlankString = (value: unknown): boolean =>
  typeof value === 'string' && (!value.length || /^\s+$/.test(value))

const applyLinePrefix = (value: string, prefix = ''): string =>
  prefix.length
    ? `${prefix}${value.includes('\n') ? value.replace(/\n/g, `\n${prefix}`) : value}`
    : value

function isUnicodeSupported(): boolean {
  if (process.platform !== 'win32') {
    return process.env['TERM'] !== 'linux'
  }
  const { env } = process
  if (
    env['WT_SESSION'] ||
    env['TERMINUS_SUBLIME'] ||
    env['ConEmuTask'] === '{cmd::Cmder}'
  ) {
    return true
  }
  const term = env['TERM']
  const termProgram = env['TERM_PROGRAM']
  return (
    termProgram === 'Terminus-Sublime' ||
    termProgram === 'vscode' ||
    term === 'xterm-256color' ||
    term === 'alacritty' ||
    term === 'rxvt-unicode' ||
    term === 'rxvt-unicode-256color' ||
    env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm'
  )
}

const unicode = isUnicodeSupported()
// These getters defer reading the shared bundle until a symbol is actually
// requested, avoiding partial exports during the bundled utils/logger cycle.
export const LOG_SYMBOLS = Object.freeze({
  get fail(): string {
    return colors.red(unicode ? '✖' : '×')
  },
  get info(): string {
    return colors.blue(unicode ? 'ℹ' : 'i')
  },
  get success(): string {
    return colors.green(unicode ? '✔' : '√')
  },
  get warn(): string {
    return colors.yellow(unicode ? '⚠' : '‼')
  },
})

export class Logger extends Console {
  static LOG_SYMBOLS = LOG_SYMBOLS

  #indention = ''
  #lastWasBlank = false
  #logCallCount = 0

  constructor(stdout?: Writable, stderr?: Writable, ignoreErrors?: boolean) {
    super({
      stdout: stdout ?? process.stdout,
      stderr: stderr ?? process.stderr,
      ...(ignoreErrors === undefined ? {} : { ignoreErrors }),
    })
  }

  get logCallCount(): number {
    return this.#logCallCount
  }

  #apply(method: 'log' | 'error', args: unknown[]): this {
    const [text, ...rest] = args
    const logArgs =
      typeof text === 'string'
        ? [applyLinePrefix(text, this.#indention), ...rest]
        : args
    Reflect.apply(Console.prototype[method], this, logArgs)
    this.#lastWasBlank = isBlankString(logArgs[0])
    this.#logCallCount += 1
    return this
  }

  #symbolApply(symbol: keyof typeof LOG_SYMBOLS, args: unknown[]): this {
    const [first, ...rest] = args
    const text = typeof first === 'string' ? first : ''
    const extras = typeof first === 'string' ? rest : args
    Console.prototype.error.call(
      this,
      applyLinePrefix(`${LOG_SYMBOLS[symbol]} ${text}`, this.#indention),
      ...extras,
    )
    this.#lastWasBlank = false
    this.#logCallCount += 1
    return this
  }

  override assert(value: unknown, ...message: unknown[]): this {
    Console.prototype.assert.call(this, value, ...(message as any[]))
    this.#lastWasBlank = false
    if (!value) {
      this.#logCallCount += 1
    }
    return this
  }

  override clear(): this {
    Console.prototype.clear.call(this)
    return this
  }
  override count(label?: string): this {
    Console.prototype.count.call(this, label)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override countReset(label?: string): this {
    Console.prototype.countReset.call(this, label)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override debug(...args: unknown[]): this {
    return this.#apply('log', args)
  }
  override dir(item?: unknown, options?: object): this {
    Console.prototype.dir.call(this, item, options)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override dirxml(...data: unknown[]): this {
    Console.prototype.dirxml.call(this, ...data)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override error(...args: unknown[]): this {
    return this.#apply('error', args)
  }
  override info(...args: unknown[]): this {
    return this.#symbolApply('info', args)
  }
  override log(...args: unknown[]): this {
    return this.#apply('log', args)
  }
  override table(tabularData?: unknown, properties?: string[]): this {
    Console.prototype.table.call(this, tabularData, properties)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override time(label?: string): this {
    Console.prototype.time.call(this, label)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override timeEnd(label?: string): this {
    Console.prototype.timeEnd.call(this, label)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override timeLog(label?: string, ...data: unknown[]): this {
    Console.prototype.timeLog.call(this, label, ...data)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override trace(...args: unknown[]): this {
    Console.prototype.trace.call(this, ...args)
    this.#logCallCount += 1
    this.#lastWasBlank = false
    return this
  }
  override warn(...args: unknown[]): this {
    return this.#symbolApply('warn', args)
  }

  fail(...args: unknown[]): this {
    return this.#symbolApply('fail', args)
  }
  success(...args: unknown[]): this {
    return this.#symbolApply('success', args)
  }
  indent(spaces = 2): this {
    this.#indention += ' '.repeat(Math.min(spaces, 1000))
    return this
  }
  dedent(spaces = 2): this {
    this.#indention = this.#indention.slice(0, -spaces)
    return this
  }
  resetIndent(): this {
    this.#indention = ''
    return this
  }
  logNewline(): this {
    return this.#lastWasBlank ? this : this.log('')
  }
  errorNewline(): this {
    return this.#lastWasBlank ? this : this.error('')
  }
  override group(...label: unknown[]): this {
    if (label.length) {
      this.log(...label)
    }
    this.indent()
    return this
  }
  override groupCollapsed(...label: unknown[]): this {
    return this.group(...label)
  }
  override groupEnd(): this {
    return this.dedent()
  }
  createTask(name: string): { run<T>(fn: () => T): T } {
    return {
      run: fn => {
        this.log(name)
        return fn()
      },
    }
  }
}

export const logger = new Logger()
