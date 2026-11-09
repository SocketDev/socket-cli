/** Return true for non-null object values that are not arrays. */
export function isObjectObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
