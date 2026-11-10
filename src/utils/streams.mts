/** Minimal ordered async-iterable transform adapted from registry 1.1.17 (MIT). */

export async function* transform<T, R>(
  iterable: AsyncIterable<T> | NodeJS.ReadableStream,
  mapper: (value: T) => Promise<R> | R,
  options: { concurrency?: number } = {},
): AsyncGenerator<R> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1))
  let batch: T[] = []
  const flush = async function* (values: T[]): AsyncGenerator<R> {
    const mapped = await Promise.all(values.map(value => mapper(value)))
    yield* mapped
  }
  for await (const value of iterable as AsyncIterable<T>) {
    batch.push(value)
    if (batch.length >= concurrency) {
      yield* flush(batch)
      batch = []
    }
  }
  if (batch.length) {
    yield* flush(batch)
  }
}
