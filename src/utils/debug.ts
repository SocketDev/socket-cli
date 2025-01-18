import { logSymbols } from './logging'
import constants from '../constants'

export function isDebug() {
  // Lazily access constants.ENV.
  return constants.ENV.SOCKET_CLI_DEBUG
}

export function debugLog(...args: any[]) {
  if (isDebug()) {
    console.error(logSymbols.info, ...args)
  }
}
