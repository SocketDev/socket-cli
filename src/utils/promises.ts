import { arrayChunk } from './arrays'

type pOptions = { signal: AbortSignal }
type pEachCallback = (value: any, options?: pOptions) => Promise<void>

export async function pEach<T>(
  array: T[],
  concurrency: number,
  callbackFn: pEachCallback,
  options?: pOptions
) {
  await pEachChunk(arrayChunk(array, concurrency), callbackFn, options)
}

export async function pEachChunk<T>(
  chunks: T[][],
  callbackFn: pEachCallback,
  options?: pOptions
) {
  const { signal } = <pOptions>{ __proto__: null, ...options }
  for (const chunk of chunks) {
    if (signal?.aborted) {
      return
    }
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      chunk.map(value =>
        signal?.aborted ? undefined : callbackFn(value, { signal })
      )
    )
  }
}
