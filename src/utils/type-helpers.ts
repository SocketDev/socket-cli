export function isErrnoException(
  value: unknown
): value is NodeJS.ErrnoException {
  if (!(value instanceof Error)) {
    return false
  }
  return (value as NodeJS.ErrnoException).code !== undefined
}
