/**
 * @template T
 * @param {T} obj
 * @param {string|undefined} key
 * @returns {(keyof T) | undefined}
 */
export function ensureIsKeyOf (obj, key) {
  return /** @type {keyof T} */ (key && Object.prototype.hasOwnProperty.call(obj, key) ? key : undefined)
}

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
