import colors from 'yoctocolors-cjs'

import isUnicodeSupported from '@socketregistry/is-unicode-supported/index.cjs'

export type LogSymbols = {
  info: string
  success: string
  warning: string
  error: string
}

let _logSymbols: LogSymbols | undefined
export function getLogSymbols() {
  if (_logSymbols === undefined) {
    _logSymbols = <LogSymbols>(isUnicodeSupported()
      ? {
          __proto__: null,
          info: colors.blue('ℹ'),
          success: colors.green('✔'),
          warning: colors.yellow('⚠'),
          error: colors.red('✖️')
        }
      : {
          __proto__: null,
          info: colors.blue('i'),
          success: colors.green('√'),
          warning: colors.yellow('‼'),
          error: colors.red('×')
        })
  }
  return _logSymbols
}

export class Logger {
  #logSymbols: LogSymbols

  constructor() {
    this.#logSymbols = getLogSymbols()
  }
  #symbolLog(symbol: string, text: string) {
    console.log(`${symbol} ${text ?? ''}`)
    return this
  }

  error(text: string) {
    return this.#symbolLog(this.#logSymbols.error, text)
  }

  info(text: string) {
    return this.#symbolLog(this.#logSymbols.info, text)
  }

  success(text: string) {
    return this.#symbolLog(this.#logSymbols.success, text)
  }

  warn(text: string) {
    return this.#symbolLog(this.#logSymbols.warning, text)
  }
}

export const logger = new Logger()
