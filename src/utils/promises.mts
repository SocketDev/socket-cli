/** Minimal bounded retry helper adapted from @socketsecurity/registry 1.1.17 lib/promises.js (MIT). */

import { setTimeout as delay } from 'node:timers/promises'

/** Execute callbacks in bounded, sequential chunks, matching registry pEach's consumed surface. */
/* eslint-disable no-await-in-loop -- Sequential promise helpers guarantee ordered settlement. */
export async function pEach<T>(
  values: readonly T[],
  callback: (value: T) => unknown | Promise<unknown>,
  options: { concurrency?: number | undefined } = {},
): Promise<void> {
  const concurrency = options.concurrency ?? (values.length || 1)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      `Expected concurrency to be a positive integer, got ${concurrency}`,
    )
  }
  for (let index = 0; index < values.length; index += concurrency) {
    await Promise.all(values.slice(index, index + concurrency).map(callback))
  }
}

export type RetryOptions = {
  args?: readonly unknown[]
  backoffFactor?: number
  baseDelayMs?: number
  jitter?: boolean
  maxDelayMs?: number
  onRetry?: (attempt: number, error: unknown, delayMs: number) => unknown
  onRetryCancelOnFalse?: boolean
  onRetryRethrow?: boolean
  retries?: number
  signal?: AbortSignal
}

export function pRetry<T>(
  callback: (...args: any[]) => Promise<T> | T,
  options?: RetryOptions & { signal?: undefined },
): Promise<T>
export function pRetry<T>(
  callback: (...args: any[]) => Promise<T> | T,
  options: RetryOptions & { signal: AbortSignal },
): Promise<T | undefined>
export async function pRetry<T>(
  callback: (...args: any[]) => Promise<T> | T,
  options: RetryOptions = {},
): Promise<T | undefined> {
  const {
    args = [],
    backoffFactor = 2,
    baseDelayMs = 200,
    jitter = true,
    maxDelayMs = 10_000,
    onRetry,
    onRetryCancelOnFalse = false,
    onRetryRethrow = false,
    retries = 0,
    signal,
  } = options
  if (signal?.aborted) {
    return undefined
  }
  let backoffDelay = baseDelayMs
  let firstError: unknown
  let hasError = false
  for (let attempt = 0; attempt <= retries && !signal?.aborted; attempt += 1) {
    try {
      return await callback(...args, { signal })
    } catch (error) {
      if (!hasError) {
        firstError = error
        hasError = true
      }
      if (attempt === retries) {
        break
      }
      const wait = Math.min(
        backoffDelay + (jitter ? Math.floor(Math.random() * backoffDelay) : 0),
        maxDelayMs,
      )
      try {
        if (
          onRetry?.(attempt + 1, error, wait) === false &&
          onRetryCancelOnFalse
        ) {
          break
        }
      } catch (retryError) {
        if (onRetryRethrow) {
          throw retryError
        }
      }
      try {
        await delay(wait, undefined, { signal })
      } catch (error) {
        if (signal?.aborted) {
          return undefined
        }
        throw error
      }
      backoffDelay = Math.min(backoffDelay * backoffFactor, maxDelayMs)
    }
  }
  if (hasError) {
    throw firstError
  }
  return undefined
}
