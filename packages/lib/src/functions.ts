/**
 * @fileoverview Common function utilities for control flow and caching.
 * Provides noop, once, and other foundational function helpers.
 */

// Type definitions
export type AsyncFunction<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult>
export type AnyFunction = (...args: unknown[]) => unknown

/**
 * A no-op function that does nothing.
 */
/*@__NO_SIDE_EFFECTS__*/
export function noop(): void {}

/**
 * Create a function that only executes once.
 */
/*@__NO_SIDE_EFFECTS__*/
export function once<T extends AnyFunction>(fn: T): T {
  let called = false
  let result: ReturnType<T>
  return function (
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): ReturnType<T> {
    if (!called) {
      called = true
      result = fn.apply(this, args) as ReturnType<T>
    }
    return result as ReturnType<T>
  } as T
}

/**
 * Wrap an async function to silently catch and ignore errors.
 */
/*@__NO_SIDE_EFFECTS__*/
export function silentWrapAsync<TArgs extends unknown[], TResult>(
  fn: AsyncFunction<TArgs, TResult>,
): (...args: TArgs) => Promise<TResult | undefined> {
  return async (...args: TArgs): Promise<TResult | undefined> => {
    try {
      const result = await fn(...args)
      return result === null ? undefined : result
    } catch {}
    return undefined
  }
}

/**
 * Execute a function with tail call optimization via trampoline.
 */
/*@__NO_SIDE_EFFECTS__*/
export function trampoline<T extends AnyFunction>(fn: T): T {
  return function (
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): ReturnType<T> {
    let result: ReturnType<T> | (() => ReturnType<T>) = fn.apply(this, args) as
      | ReturnType<T>
      | (() => ReturnType<T>)
    while (typeof result === 'function') {
      result = (result as () => ReturnType<T> | (() => ReturnType<T>))() as
        | ReturnType<T>
        | (() => ReturnType<T>)
    }
    return result as ReturnType<T>
  } as T
}
