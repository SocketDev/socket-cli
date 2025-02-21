import colors from 'yoctocolors-cjs'

import isUnicodeSupported from '@socketregistry/is-unicode-supported/index.cjs'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

export const logSymbols = isUnicodeSupported()
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
    }

export class Logger {
  #spinnerLogger: ReturnType<typeof Spinner>
  constructor() {
    this.#spinnerLogger = new Spinner()
  }

  error(text: string) {
    this.#spinnerLogger.error(text)
  }

  info(text: string) {
    this.#spinnerLogger.info(text)
  }

  warn(text: string) {
    this.#spinnerLogger.warning(text)
  }
}

export const logger = new Logger()
