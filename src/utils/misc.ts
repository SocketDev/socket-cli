import { logSymbols } from './color-or-markdown'

export function createDebugLogger(
  printDebugLogs?: boolean
): typeof console.error {
  return printDebugLogs
    ? (...params: unknown[]): void => console.error(logSymbols.info, ...params)
    : () => {}
}
