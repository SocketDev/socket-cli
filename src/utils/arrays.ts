export function arrayUnique<T>(array: T[]): T[] {
  return [...new Set(array)]
}
