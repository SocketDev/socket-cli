import { logSymbols } from './chalk-markdown.js'

/**
 * @param {boolean|undefined} printDebugLogs
 * @returns {typeof console.error}
 */
export function createDebugLogger (printDebugLogs) {
  return printDebugLogs
    // eslint-disable-next-line no-console
    ? (...params) => console.error(logSymbols.info, ...params)
    : () => {}
}

/**
 * @param {(string|undefined)[]} list
 * @param {string} separator
 * @returns {string}
 */
export function stringJoinWithSeparateFinalSeparator (list, separator = ' and ') {
  const values = list.filter(value => !!value)

  if (values.length < 2) {
    return values[0] || ''
  }

  const finalValue = values.pop()

  return values.join(', ') + separator + finalValue
}

/**
 * Returns a new object with only the specified keys from the input object
 *
 * @template {Record<string,any>} T
 * @template {keyof T} K
 * @param {T} input
 * @param {K[]|ReadonlyArray<K>} keys
 * @returns {Pick<T, K>}
 */
export function pick (input, keys) {
  /** @type {Partial<Pick<T, K>>} */
  const result = {}

  for (const key of keys) {
    result[key] = input[key]
  }

  return /** @type {Pick<T, K>} */ (result)
}

/**
 * @param {Record<string,any>} obj
 * @returns {boolean}
 */
export function objectSome (obj) {
  for (const key in obj) {
    if (obj[key]) {
      return true
    }
  }
  return false
}
