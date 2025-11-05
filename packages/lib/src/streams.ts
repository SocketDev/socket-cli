/**
 * @fileoverview Stream processing utilities with streaming-iterables integration.
 * Provides async stream handling and transformation functions.
 */

import type { IterationOptions } from './promises'
import { normalizeIterationOptions, pRetry } from './promises'

let _streamingIterables:
  | {
      parallelMap: <T, U>(
        concurrency: number,
        mapper: (item: T) => Promise<U>,
        iterable: Iterable<T> | AsyncIterable<T>,
      ) => AsyncIterable<U>
      transform: <T, U>(
        concurrency: number,
        mapper: (item: T) => Promise<U>,
        iterable: Iterable<T> | AsyncIterable<T>,
      ) => AsyncIterable<U>
    }
  | undefined
/**
 * Get the streaming-iterables module.
 * @private
 */
/*@__NO_SIDE_EFFECTS__*/
function getStreamingIterables() {
  if (_streamingIterables === undefined) {
    _streamingIterables = /*@__PURE__*/ require('streaming-iterables')
  }
  return _streamingIterables
}

/**
 * Execute a function for each item in an iterable in parallel.
 */
/*@__NO_SIDE_EFFECTS__*/
export async function parallelEach<T>(
  iterable: Iterable<T> | AsyncIterable<T>,
  func: (item: T) => Promise<unknown>,
  options?: number | IterationOptions,
): Promise<void> {
  for await (const _ of parallelMap(iterable, func, options)) {
    /* empty block */
  }
}

/**
 * Map over an iterable in parallel with concurrency control.
 */
/*@__NO_SIDE_EFFECTS__*/
export function parallelMap<T, U>(
  iterable: Iterable<T> | AsyncIterable<T>,
  func: (item: T) => Promise<U>,
  options?: number | IterationOptions,
): AsyncIterable<U> {
  const streamingIterables = getStreamingIterables()
  const opts = normalizeIterationOptions(options)
  const result = streamingIterables?.parallelMap(
    opts.concurrency,
    async (item: T) => {
      const result = await pRetry((...args: unknown[]) => func(args[0] as T), {
        ...opts.retries,
        args: [item],
      })
      return result as U
    },
    iterable,
  )
  return result as AsyncIterable<U>
}

/**
 * Transform an iterable with a function.
 */
/*@__NO_SIDE_EFFECTS__*/
export function transform<T, U>(
  iterable: Iterable<T> | AsyncIterable<T>,
  func: (item: T) => Promise<U>,
  options?: number | IterationOptions,
): AsyncIterable<U> {
  const streamingIterables = getStreamingIterables()
  const opts = normalizeIterationOptions(options)
  const result = streamingIterables?.transform(
    opts.concurrency,
    async (item: T) => {
      const result = await pRetry((...args: unknown[]) => func(args[0] as T), {
        ...opts.retries,
        args: [item],
      })
      return result as U
    },
    iterable,
  )
  return result as AsyncIterable<U>
}
