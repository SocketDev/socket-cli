/**
 * @param {unknown} value
 * @returns {value is NodeJS.ErrnoException}
 */
exports.isErrnoException = function isErrnoException (value) {
  if (!(value instanceof Error)) {
    return false
  }

  const errnoException = /** @type NodeJS.ErrnoException} */ (value)

  return errnoException.code !== undefined
}
