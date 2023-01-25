/**
 * @param {unknown} value
 * @returns {value is NodeJS.ErrnoException}
 */
export function isErrnoException (value) {
  if (!(value instanceof Error)) {
    return false
  }

  const errnoException = /** @type NodeJS.ErrnoException} */ (value)

  return errnoException.code !== undefined
}
