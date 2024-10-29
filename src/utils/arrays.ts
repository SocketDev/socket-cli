export function arrayChunk<T>(arr: T[], size: number = 2): Array<T[]> {
  const { length } = arr
  const chunkSize = Math.min(length, size)
  const chunks = []
  for (let i = 0; i < length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize))
  }
  return chunks
}

export function arrayUnique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
