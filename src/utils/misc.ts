import { logSymbols } from './color-or-markdown'

export function createDebugLogger(
  printDebugLogs?: boolean
): typeof console.error {
  return printDebugLogs
    ? (...params: unknown[]): void => console.error(logSymbols.info, ...params)
    : () => {}
}

export function isErrnoException(
  value: unknown
): value is NodeJS.ErrnoException {
  if (!(value instanceof Error)) {
    return false
  }
  return (value as NodeJS.ErrnoException).code !== undefined
}

export function stringJoinWithSeparateFinalSeparator(
  list: (string | undefined)[],
  separator: string = ' and '
): string {
  const values = list.filter(value => !!value)
  if (values.length < 2) {
    return values[0] || ''
  }
  const finalValue = values.pop()
  return values.join(', ') + separator + finalValue
}
