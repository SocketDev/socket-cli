import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { logSymbols } from './log-symbols'

export function createDebugLogger(
  printDebugLogs?: boolean
): typeof console.error {
  return printDebugLogs
    ? (...params: unknown[]): void => console.error(logSymbols.info, ...params)
    : () => {}
}

class Logger {
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
