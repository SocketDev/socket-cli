/**
 * @param {boolean|undefined} printDebugLogs
 * @returns {typeof console.error}
 */
export function createDebugLogger (printDebugLogs) {
  if (printDebugLogs) {
    // eslint-disable-next-line no-console
    return console.error.bind(console)
  }
  return () => {}
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
