import { logSymbols } from './chalk-markdown'

export function createDebugLogger(
  printDebugLogs?: boolean
): typeof console.error {
  return printDebugLogs
    ? (...params: unknown[]): void => console.error(logSymbols.info, ...params)
    : () => {}
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

export function pick<T extends Record<string, any>, K extends keyof T>(
  input: T,
  keys: K[] | ReadonlyArray<K>
): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {}

  for (const key of keys) {
    result[key] = input[key]
  }

  return result as Pick<T, K>
}

export function objectSome(obj: Record<string, any>): boolean {
  for (const key in obj) {
    if (obj[key]) {
      return true
    }
  }
  return false
}
