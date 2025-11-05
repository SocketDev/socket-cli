/**
 * @fileoverview Promise utilities including chunked iteration and timers.
 * Provides async control flow helpers and promise-based timing functions.
 */

import { UNDEFINED_TOKEN } from '#constants/core'
import { getAbortSignal } from '#constants/process'

import { arrayChunk } from './arrays'

const abortSignal = getAbortSignal()

/**
 * Configuration options for retry behavior with exponential backoff.
 *
 * Controls how failed operations are retried, including timing, backoff strategy,
 * and callback hooks for observing or modifying retry behavior.
 */
export interface RetryOptions {
  /**
   * Arguments to pass to the callback function on each attempt.
   *
   * @default []
   */
  args?: unknown[] | undefined

  /**
   * Multiplier for exponential backoff (e.g., 2 doubles delay each retry).
   * Each retry waits `baseDelayMs * (backoffFactor ** attemptNumber)`.
   *
   * @default 2
   * @example
   * // With backoffFactor: 2, baseDelayMs: 100
   * // Retry 1: 100ms
   * // Retry 2: 200ms
   * // Retry 3: 400ms
   */
  backoffFactor?: number | undefined

  /**
   * Initial delay before the first retry (in milliseconds).
   * This is the base value for exponential backoff calculations.
   *
   * @default 200
   */
  baseDelayMs?: number | undefined

  // REMOVED: Deprecated `factor` option
  // Migration: Use `backoffFactor` instead

  /**
   * Whether to apply randomness to spread out retries and avoid thundering herd.
   * When `true`, adds random delay between 0 and current delay value.
   *
   * @default true
   * @example
   * // With jitter: true, delay: 100ms
   * // Actual wait: 100ms + random(0-100ms) = 100-200ms
   */
  jitter?: boolean | undefined

  /**
   * Upper limit for any backoff delay (in milliseconds).
   * Prevents exponential backoff from growing unbounded.
   *
   * @default 10000
   */
  maxDelayMs?: number | undefined

  // REMOVED: Deprecated `maxTimeout` option
  // Migration: Use `maxDelayMs` instead

  // REMOVED: Deprecated `minTimeout` option
  // Migration: Use `baseDelayMs` instead

  /**
   * Callback invoked on each retry attempt.
   * Can observe errors, customize delays, or cancel retries.
   *
   * @param attempt - The current attempt number (1-based: 1, 2, 3, ...)
   * @param error - The error that triggered this retry
   * @param delay - The calculated delay in milliseconds before next retry
   * @returns `false` to cancel retries (if `onRetryCancelOnFalse` is `true`),
   *          a number to override the delay, or `undefined` to use calculated delay
   *
   * @example
   * // Log each retry
   * onRetry: (attempt, error, delay) => {
   *   console.log(`Retry ${attempt} after ${delay}ms: ${error}`)
   * }
   *
   * @example
   * // Cancel retries for specific errors
   * onRetry: (attempt, error) => {
   *   if (error instanceof ValidationError) return false
   * }
   *
   * @example
   * // Use custom delay
   * onRetry: (attempt) => attempt * 1000 // 1s, 2s, 3s, ...
   */
  onRetry?:
    | ((
        attempt: number,
        error: unknown,
        delay: number,
      ) => boolean | number | undefined)
    | undefined

  /**
   * Whether `onRetry` can cancel retries by returning `false`.
   * When `true`, returning `false` from `onRetry` stops retry attempts.
   *
   * @default false
   */
  onRetryCancelOnFalse?: boolean | undefined

  /**
   * Whether errors thrown by `onRetry` should propagate.
   * When `true`, exceptions in `onRetry` terminate the retry loop.
   * When `false`, exceptions in `onRetry` are silently caught.
   *
   * @default false
   */
  onRetryRethrow?: boolean | undefined

  /**
   * Number of retry attempts (0 = no retries, only initial attempt).
   * The callback is executed `retries + 1` times total (initial + retries).
   *
   * @default 0
   * @example
   * // retries: 0 -> 1 total attempt (no retries)
   * // retries: 3 -> 4 total attempts (1 initial + 3 retries)
   */
  retries?: number | undefined

  /**
   * AbortSignal to support cancellation of retry operations.
   * When aborted, immediately stops retrying and returns `undefined`.
   *
   * @default process abort signal
   * @example
   * const controller = new AbortController()
   * pRetry(fn, { signal: controller.signal })
   * // Later: controller.abort() to cancel
   */
  signal?: AbortSignal | undefined
}

/**
 * Configuration options for iteration functions with concurrency control.
 *
 * Controls how array operations are parallelized and retried.
 */
export interface IterationOptions {
  /**
   * The number of concurrent executions performed at one time.
   * Higher values increase parallelism but may overwhelm resources.
   *
   * @default 1
   * @example
   * // Process 5 items at a time
   * await pEach(items, processItem, { concurrency: 5 })
   */
  concurrency?: number | undefined

  /**
   * Retry configuration as a number (retry count) or full options object.
   * Applied to each individual item's callback execution.
   *
   * @default 0 (no retries)
   * @example
   * // Simple: retry each item up to 3 times
   * await pEach(items, fetchItem, { retries: 3 })
   *
   * @example
   * // Advanced: custom backoff for each item
   * await pEach(items, fetchItem, {
   *   retries: {
   *     retries: 3,
   *     baseDelayMs: 1000,
   *     backoffFactor: 2
   *   }
   * })
   */
  retries?: number | RetryOptions | undefined

  /**
   * AbortSignal to support cancellation of the entire iteration.
   * When aborted, stops processing remaining items.
   *
   * @default process abort signal
   */
  signal?: AbortSignal | undefined
}

let _timers: typeof import('node:timers/promises') | undefined
/**
 * Get the timers/promises module.
 * Uses lazy loading to avoid Webpack bundling issues.
 *
 * @private
 * @returns The Node.js timers/promises module
 */
/*@__NO_SIDE_EFFECTS__*/
function getTimers() {
  if (_timers === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _timers = /*@__PURE__*/ require('node:timers/promises')
  }
  return _timers as typeof import('node:timers/promises')
}

/**
 * Normalize options for iteration functions.
 *
 * Converts various option formats into a consistent structure with defaults applied.
 * Handles number shorthand for concurrency and ensures minimum values.
 *
 * @param options - Concurrency as number, or full options object, or undefined
 * @returns Normalized options with concurrency, retries, and signal
 *
 * @example
 * // Number shorthand for concurrency
 * normalizeIterationOptions(5)
 * // => { concurrency: 5, retries: {...}, signal: AbortSignal }
 *
 * @example
 * // Full options
 * normalizeIterationOptions({ concurrency: 3, retries: 2 })
 * // => { concurrency: 3, retries: {...}, signal: AbortSignal }
 */
/*@__NO_SIDE_EFFECTS__*/
export function normalizeIterationOptions(
  options?: number | IterationOptions | undefined,
): { concurrency: number; retries: RetryOptions; signal: AbortSignal } {
  // Handle number as concurrency shorthand
  const opts = typeof options === 'number' ? { concurrency: options } : options

  const {
    // The number of concurrent executions performed at one time.
    concurrency = 1,
    // Retries as a number or options object.
    retries,
    // AbortSignal used to support cancellation.
    signal = abortSignal,
  } = { __proto__: null, ...opts } as IterationOptions

  // Ensure concurrency is at least 1
  const normalizedConcurrency = Math.max(1, concurrency)
  const retryOpts = resolveRetryOptions(retries)
  return {
    __proto__: null,
    concurrency: normalizedConcurrency,
    retries: normalizeRetryOptions({ signal, ...retryOpts }),
    signal,
  } as { concurrency: number; retries: RetryOptions; signal: AbortSignal }
}

/**
 * Normalize options for retry functionality.
 *
 * Converts various retry option formats into a complete configuration with all defaults.
 * Handles legacy property names (`factor`, `minTimeout`, `maxTimeout`) and merges them
 * with modern equivalents.
 *
 * @param options - Retry count as number, or full options object, or undefined
 * @returns Normalized retry options with all properties set
 *
 * @example
 * // Number shorthand
 * normalizeRetryOptions(3)
 * // => { retries: 3, baseDelayMs: 200, backoffFactor: 2, ... }
 *
 * @example
 * // Full options with defaults filled in
 * normalizeRetryOptions({ retries: 5, baseDelayMs: 500 })
 * // => { retries: 5, baseDelayMs: 500, backoffFactor: 2, jitter: true, ... }
 */
/*@__NO_SIDE_EFFECTS__*/
export function normalizeRetryOptions(
  options?: number | RetryOptions | undefined,
): RetryOptions {
  const resolved = resolveRetryOptions(options)
  const {
    // Arguments to pass to the callback function.
    args = [],
    // Multiplier for exponential backoff (e.g., 2 doubles delay each retry).
    backoffFactor = 2,
    // Initial delay before the first retry (in milliseconds).
    baseDelayMs = 200,
    // Whether to apply randomness to spread out retries.
    jitter = true,
    // Upper limit for any backoff delay (in milliseconds).
    maxDelayMs = 10_000,
    // Optional callback invoked on each retry attempt:
    // (attempt: number, error: unknown, delay: number) => void
    onRetry,
    // Whether onRetry can cancel retries by returning `false`.
    onRetryCancelOnFalse = false,
    // Whether onRetry will rethrow errors.
    onRetryRethrow = false,
    // Number of retry attempts (0 = no retries, only initial attempt).
    retries = 0,
    // AbortSignal used to support cancellation.
    signal = abortSignal,
  } = resolved
  return {
    args,
    backoffFactor,
    baseDelayMs,
    jitter,
    maxDelayMs,
    onRetry,
    onRetryCancelOnFalse,
    onRetryRethrow,
    retries,
    signal,
  } as RetryOptions
}

/**
 * Resolve retry options from various input formats.
 *
 * Converts shorthand and partial options into a base configuration that can be
 * further normalized. This is an internal helper for option processing.
 *
 * @param options - Retry count as number, or partial options object, or undefined
 * @returns Resolved retry options with defaults for basic properties
 *
 * @example
 * resolveRetryOptions(3)
 * // => { retries: 3, minTimeout: 200, maxTimeout: 10000, factor: 2 }
 *
 * @example
 * resolveRetryOptions({ retries: 5, maxTimeout: 5000 })
 * // => { retries: 5, minTimeout: 200, maxTimeout: 5000, factor: 2 }
 */
/*@__NO_SIDE_EFFECTS__*/
export function resolveRetryOptions(
  options?: number | RetryOptions | undefined,
): RetryOptions {
  const defaults = {
    __proto__: null,
    retries: 0,
    baseDelayMs: 200,
    maxDelayMs: 10_000,
    backoffFactor: 2,
  }

  if (typeof options === 'number') {
    return { ...defaults, retries: options }
  }

  return options ? { ...defaults, ...options } : defaults
}

/**
 * Execute an async function for each array element with concurrency control.
 *
 * Processes array items in parallel batches (chunks) with configurable concurrency.
 * Each item's callback can be retried independently on failure. Similar to
 * `Promise.all(array.map(fn))` but with controlled parallelism.
 *
 * @template T - The type of array elements
 * @param array - The array to iterate over
 * @param callbackFn - Async function to execute for each item
 * @param options - Concurrency as number, or full iteration options, or undefined
 * @returns Promise that resolves when all items are processed
 *
 * @example
 * // Process items serially (concurrency: 1)
 * await pEach(urls, async (url) => {
 *   await fetch(url)
 * })
 *
 * @example
 * // Process 5 items at a time
 * await pEach(files, async (file) => {
 *   await processFile(file)
 * }, 5)
 *
 * @example
 * // With retries and cancellation
 * const controller = new AbortController()
 * await pEach(tasks, async (task) => {
 *   await executeTask(task)
 * }, {
 *   concurrency: 3,
 *   retries: 2,
 *   signal: controller.signal
 * })
 */
/*@__NO_SIDE_EFFECTS__*/
export async function pEach<T>(
  array: T[],
  callbackFn: (item: T) => Promise<unknown>,
  options?: number | IterationOptions | undefined,
): Promise<void> {
  const iterOpts = normalizeIterationOptions(options)
  const { concurrency, retries, signal } = iterOpts

  // Process items with concurrency control.
  const chunks = arrayChunk(array, concurrency)
  for (const chunk of chunks) {
    if (signal?.aborted) {
      return
    }
    // Process each item in the chunk concurrently.
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled(
      chunk.map((item: T) =>
        pRetry((...args: unknown[]) => callbackFn(args[0] as T), {
          ...retries,
          args: [item],
          signal,
        }),
      ),
    )
  }
}

/**
 * Filter an array asynchronously with concurrency control.
 *
 * Tests each element with an async predicate function, processing items in parallel
 * batches. Returns a new array with only items that pass the test. Similar to
 * `array.filter()` but for async predicates with controlled concurrency.
 *
 * @template T - The type of array elements
 * @param array - The array to filter
 * @param callbackFn - Async predicate function returning true to keep item
 * @param options - Concurrency as number, or full iteration options, or undefined
 * @returns Promise resolving to filtered array
 *
 * @example
 * // Filter serially
 * const activeUsers = await pFilter(users, async (user) => {
 *   return await isUserActive(user.id)
 * })
 *
 * @example
 * // Filter with concurrency
 * const validFiles = await pFilter(filePaths, async (path) => {
 *   try {
 *     await fs.access(path)
 *     return true
 *   } catch {
 *     return false
 *   }
 * }, 10)
 *
 * @example
 * // With retries for flaky checks
 * const reachable = await pFilter(endpoints, async (url) => {
 *   const response = await fetch(url)
 *   return response.ok
 * }, {
 *   concurrency: 5,
 *   retries: 2
 * })
 */
/*@__NO_SIDE_EFFECTS__*/
export async function pFilter<T>(
  array: T[],
  callbackFn: (item: T) => Promise<boolean>,
  options?: number | IterationOptions | undefined,
): Promise<T[]> {
  const iterOpts = normalizeIterationOptions(options)
  return (
    await pFilterChunk(
      arrayChunk(array, iterOpts.concurrency),
      callbackFn,
      iterOpts.retries,
    )
  ).flat()
}

/**
 * Process array in chunks with an async callback.
 *
 * Divides the array into fixed-size chunks and processes each chunk sequentially
 * with the callback. Useful for batch operations like bulk database inserts or
 * API calls with payload size limits.
 *
 * @template T - The type of array elements
 * @param array - The array to process in chunks
 * @param callbackFn - Async function to execute for each chunk
 * @param options - Chunk size and retry options
 * @returns Promise that resolves when all chunks are processed
 *
 * @example
 * // Insert records in batches of 100
 * await pEachChunk(records, async (chunk) => {
 *   await db.batchInsert(chunk)
 * }, { chunkSize: 100 })
 *
 * @example
 * // Upload files in batches with retries
 * await pEachChunk(files, async (batch) => {
 *   await uploadBatch(batch)
 * }, {
 *   chunkSize: 50,
 *   retries: 3,
 *   baseDelayMs: 1000
 * })
 *
 * @example
 * // Process with cancellation support
 * const controller = new AbortController()
 * await pEachChunk(items, async (chunk) => {
 *   await processChunk(chunk)
 * }, {
 *   chunkSize: 25,
 *   signal: controller.signal
 * })
 */
/*@__NO_SIDE_EFFECTS__*/
export async function pEachChunk<T>(
  array: T[],
  callbackFn: (chunk: T[]) => Promise<unknown>,
  options?: (RetryOptions & { chunkSize?: number | undefined }) | undefined,
): Promise<void> {
  const { chunkSize = 100, ...retryOpts } = options || {}
  const chunks = arrayChunk(array, chunkSize)
  const normalizedRetryOpts = normalizeRetryOptions(retryOpts)
  const { signal } = normalizedRetryOpts
  for (const chunk of chunks) {
    if (signal?.aborted) {
      return
    }
    // eslint-disable-next-line no-await-in-loop
    await pRetry((...args: unknown[]) => callbackFn(args[0] as T[]), {
      ...normalizedRetryOpts,
      args: [chunk],
    })
  }
}

/**
 * Filter chunked arrays with an async predicate.
 *
 * Internal helper for `pFilter`. Processes pre-chunked arrays, applying the
 * predicate to each element within each chunk with retry support.
 *
 * @template T - The type of array elements
 * @param chunks - Pre-chunked array (array of arrays)
 * @param callbackFn - Async predicate function
 * @param options - Retry count as number, or full retry options, or undefined
 * @returns Promise resolving to array of filtered chunks
 *
 * @example
 * const chunks = [[1, 2], [3, 4], [5, 6]]
 * const filtered = await pFilterChunk(chunks, async (n) => n % 2 === 0)
 * // => [[2], [4], [6]]
 */
/*@__NO_SIDE_EFFECTS__*/
export async function pFilterChunk<T>(
  chunks: T[][],
  callbackFn: (value: T) => Promise<boolean>,
  options?: number | RetryOptions | undefined,
): Promise<T[][]> {
  const retryOpts = normalizeRetryOptions(options)
  const { signal } = retryOpts
  const { length } = chunks
  const filteredChunks = Array(length)
  for (let i = 0; i < length; i += 1) {
    // Process each chunk, filtering based on the callback function.
    if (signal?.aborted) {
      filteredChunks[i] = []
    } else {
      const chunk = chunks[i] as T[]
      // eslint-disable-next-line no-await-in-loop
      const settled = await Promise.allSettled(
        chunk.map(value =>
          pRetry((...args: unknown[]) => callbackFn(args[0] as T), {
            ...retryOpts,
            args: [value],
          }),
        ),
      )
      const predicateResults = settled.map(r =>
        r.status === 'fulfilled' ? r.value : false,
      )
      filteredChunks[i] = chunk.filter((_v, i) => predicateResults[i])
    }
  }
  return filteredChunks
}

/**
 * Retry an async function with exponential backoff.
 *
 * Attempts to execute a function multiple times with increasing delays between attempts.
 * Implements exponential backoff with optional jitter to prevent thundering herd problems.
 * Supports custom retry logic via `onRetry` callback.
 *
 * The delay calculation follows: `min(baseDelayMs * (backoffFactor ** attempt), maxDelayMs)`
 * With jitter: adds random value between 0 and calculated delay.
 *
 * @template T - The return type of the callback function
 * @param callbackFn - Async function to retry
 * @param options - Retry count as number, or full retry options, or undefined
 * @returns Promise resolving to callback result, or `undefined` if aborted
 *
 * @throws {Error} The last error if all retry attempts fail
 *
 * @example
 * // Simple retry: 3 attempts with default backoff
 * const data = await pRetry(async () => {
 *   return await fetchData()
 * }, 3)
 *
 * @example
 * // Custom backoff strategy
 * const result = await pRetry(async () => {
 *   return await unreliableOperation()
 * }, {
 *   retries: 5,
 *   baseDelayMs: 1000,    // Start at 1 second
 *   backoffFactor: 2,      // Double each time
 *   maxDelayMs: 30000,     // Cap at 30 seconds
 *   jitter: true           // Add randomness
 * })
 * // Delays: ~1s, ~2s, ~4s, ~8s, ~16s (each ± random jitter)
 *
 * @example
 * // With custom retry logic
 * const data = await pRetry(async () => {
 *   return await apiCall()
 * }, {
 *   retries: 3,
 *   onRetry: (attempt, error, delay) => {
 *     console.log(`Attempt ${attempt} failed: ${error}`)
 *     console.log(`Waiting ${delay}ms before retry...`)
 *
 *     // Cancel retries for client errors (4xx)
 *     if (error.statusCode >= 400 && error.statusCode < 500) {
 *       return false
 *     }
 *
 *     // Use longer delay for rate limit errors
 *     if (error.statusCode === 429) {
 *       return 60000 // Wait 1 minute
 *     }
 *   },
 *   onRetryCancelOnFalse: true
 * })
 *
 * @example
 * // With cancellation support
 * const controller = new AbortController()
 * setTimeout(() => controller.abort(), 5000) // Cancel after 5s
 *
 * const result = await pRetry(async ({ signal }) => {
 *   return await longRunningTask(signal)
 * }, {
 *   retries: 10,
 *   signal: controller.signal
 * })
 * // Returns undefined if aborted
 *
 * @example
 * // Pass arguments to callback
 * const result = await pRetry(
 *   async (url, options) => {
 *     return await fetch(url, options)
 *   },
 *   {
 *     retries: 3,
 *     args: ['https://api.example.com', { method: 'POST' }]
 *   }
 * )
 */
/*@__NO_SIDE_EFFECTS__*/
export async function pRetry<T>(
  callbackFn: (...args: unknown[]) => Promise<T>,
  options?: number | RetryOptions | undefined,
): Promise<T | undefined> {
  const {
    args,
    backoffFactor,
    baseDelayMs,
    jitter,
    maxDelayMs,
    onRetry,
    onRetryCancelOnFalse,
    onRetryRethrow,
    retries,
    signal,
  } = normalizeRetryOptions(options)
  if (signal?.aborted) {
    return undefined
  }
  if (retries === 0) {
    return await callbackFn(...(args || []), { signal })
  }

  const timers = getTimers()

  let attempts = retries as number
  let delay = baseDelayMs as number
  let error: unknown = UNDEFINED_TOKEN

  while (attempts-- >= 0) {
    // Check abort before attempt.
    if (signal?.aborted) {
      return undefined
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      return await callbackFn(...(args || []), { signal })
    } catch (e) {
      if (error === UNDEFINED_TOKEN) {
        error = e
      }
      if (attempts < 0) {
        break
      }
      let waitTime = delay
      if (jitter) {
        // Add randomness: Pick a value between 0 and `delay`.
        waitTime += Math.floor(Math.random() * delay)
      }
      // Clamp wait time to max delay.
      waitTime = Math.min(waitTime, maxDelayMs as number)
      if (typeof onRetry === 'function') {
        try {
          const result = onRetry((retries as number) - attempts, e, waitTime)
          if (result === false && onRetryCancelOnFalse) {
            break
          }
          // If onRetry returns a number, use it as the custom delay.
          if (typeof result === 'number' && result >= 0) {
            waitTime = Math.min(result, maxDelayMs as number)
          }
        } catch (e) {
          if (onRetryRethrow) {
            throw e
          }
        }
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        await timers.setTimeout(waitTime, undefined, { signal })
      } catch {
        // setTimeout was aborted.
        return undefined
      }

      // Check abort again after delay.
      if (signal?.aborted) {
        return undefined
      }

      // Exponentially increase the delay for the next attempt, capping at maxDelayMs.
      delay = Math.min(delay * (backoffFactor as number), maxDelayMs as number)
    }
  }
  if (error !== UNDEFINED_TOKEN) {
    throw error
  }
  return undefined
}
