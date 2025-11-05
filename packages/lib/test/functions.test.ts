/**
 * @fileoverview Unit tests for functional programming utilities.
 *
 * Tests function composition and control flow helpers:
 * - noop() no-operation function (returns undefined)
 * - once() ensures function executes exactly once
 * - silentWrapAsync() wraps async functions with error suppression
 * - trampoline() enables tail-call optimization for recursive functions
 * Used throughout Socket tools for callback handling and recursion optimization.
 */

import {
  noop,
  once,
  silentWrapAsync,
  trampoline,
} from '@socketsecurity/lib/functions'
import { describe, expect, it, vi } from 'vitest'

describe('functions', () => {
  describe('noop', () => {
    it('should be a function', () => {
      expect(typeof noop).toBe('function')
    })

    it('should return undefined', () => {
      expect(noop()).toBeUndefined()
    })

    it('should not throw with any arguments', () => {
      expect(() => (noop as any)(1, 2, 3)).not.toThrow()
      expect(() => (noop as any)('test', { foo: 'bar' })).not.toThrow()
    })

    it('should always return undefined regardless of arguments', () => {
      expect((noop as any)(1, 2, 3)).toBeUndefined()
      expect((noop as any)('test', { foo: 'bar' })).toBeUndefined()
    })
  })

  describe('once', () => {
    it('should execute function only once', () => {
      const fn = vi.fn((x: number) => x * 2)
      const onceFn = once(fn)

      expect(onceFn(5)).toBe(10)
      expect(onceFn(10)).toBe(10) // Still returns first result
      expect(onceFn(20)).toBe(10) // Still returns first result

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should return the same result on subsequent calls', () => {
      const onceFn = once(() => Math.random())
      const firstResult = onceFn()
      const secondResult = onceFn()
      const thirdResult = onceFn()

      expect(firstResult).toBe(secondResult)
      expect(secondResult).toBe(thirdResult)
    })

    it('should work with functions that return undefined', () => {
      const fn = vi.fn(() => undefined)
      const onceFn = once(fn)

      expect(onceFn()).toBeUndefined()
      expect(onceFn()).toBeUndefined()
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should work with functions that return null', () => {
      const fn = vi.fn(() => null)
      const onceFn = once(fn)

      expect(onceFn()).toBeNull()
      expect(onceFn()).toBeNull()
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should work with functions that return objects', () => {
      const obj = { value: 42 }
      const fn = vi.fn(() => obj)
      const onceFn = once(fn)

      const result1 = onceFn()
      const result2 = onceFn()

      expect(result1).toBe(obj)
      expect(result2).toBe(obj)
      expect(result1).toBe(result2)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should preserve this context', () => {
      const context = {
        value: 42,
        getValue: once(function (this: { value: number }) {
          return this.value
        }),
      }

      expect(context.getValue()).toBe(42)
      expect(context.getValue()).toBe(42)
    })

    it('should pass arguments on first call', () => {
      const fn = vi.fn((a: number, b: number, c: number) => a + b + c)
      const onceFn = once(fn)

      onceFn(1, 2, 3)
      expect(fn).toHaveBeenCalledWith(1, 2, 3)
    })

    it('should work with functions that throw', () => {
      const fn = vi.fn(() => {
        throw new Error('test error')
      })
      const onceFn = once(fn)

      expect(() => onceFn()).toThrow('test error')
      // Second call should not throw, but return undefined
      // because the error was thrown before result was assigned
      expect(() => onceFn()).not.toThrow()
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should work with no-argument functions', () => {
      const fn = vi.fn(() => 'result')
      const onceFn = once(fn)

      expect(onceFn()).toBe('result')
      expect(onceFn()).toBe('result')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should work with multiple argument functions', () => {
      const fn = vi.fn((a: string, b: number, c: boolean) => ({ a, b, c }))
      const onceFn = once(fn)

      const result1 = onceFn('test', 42, true)
      const result2 = onceFn('different', 99, false)

      expect(result1).toEqual({ a: 'test', b: 42, c: true })
      expect(result2).toBe(result1)
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('silentWrapAsync', () => {
    it('should return result on success', async () => {
      const fn = async (x: number) => x * 2
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn(5)
      expect(result).toBe(10)
    })

    it('should return undefined on error', async () => {
      const fn = async () => {
        throw new Error('test error')
      }
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn()
      expect(result).toBeUndefined()
    })

    it('should convert null to undefined', async () => {
      const fn = async () => null
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn()
      expect(result).toBeUndefined()
    })

    it('should not convert other falsy values', async () => {
      const fn0 = async () => 0
      const wrappedFn0 = silentWrapAsync(fn0)
      expect(await wrappedFn0()).toBe(0)

      const fnFalse = async () => false
      const wrappedFnFalse = silentWrapAsync(fnFalse)
      expect(await wrappedFnFalse()).toBe(false)

      const fnEmptyString = async () => ''
      const wrappedFnEmptyString = silentWrapAsync(fnEmptyString)
      expect(await wrappedFnEmptyString()).toBe('')
    })

    it('should handle undefined result', async () => {
      const fn = async () => undefined
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn()
      expect(result).toBeUndefined()
    })

    it('should pass arguments correctly', async () => {
      const fn = vi.fn(async (a: number, b: string) => `${a}-${b}`)
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn(42, 'test')
      expect(result).toBe('42-test')
      expect(fn).toHaveBeenCalledWith(42, 'test')
    })

    it('should silently catch all error types', async () => {
      const fnError = async () => {
        throw new Error('error')
      }
      const fnString = async () => {
        throw 'string error'
      }
      const fnNumber = async () => {
        throw 42
      }

      expect(await silentWrapAsync(fnError)()).toBeUndefined()
      expect(await silentWrapAsync(fnString)()).toBeUndefined()
      expect(await silentWrapAsync(fnNumber)()).toBeUndefined()
    })

    it('should work with functions returning objects', async () => {
      const obj = { value: 42 }
      const fn = async () => obj
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn()
      expect(result).toBe(obj)
    })

    it('should work with functions returning arrays', async () => {
      const arr = [1, 2, 3]
      const fn = async () => arr
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn()
      expect(result).toBe(arr)
    })

    it('should handle async functions with multiple arguments', async () => {
      const fn = async (a: number, b: number, c: number) => a + b + c
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn(1, 2, 3)
      expect(result).toBe(6)
    })

    it('should handle promise rejections', async () => {
      const fn = async () => await Promise.reject(new Error('rejected'))
      const wrappedFn = silentWrapAsync(fn)

      const result = await wrappedFn()
      expect(result).toBeUndefined()
    })
  })

  describe('trampoline', () => {
    it('should execute non-recursive function normally', () => {
      const fn = (x: number) => x * 2
      const trampolineFn = trampoline(fn)

      expect(trampolineFn(5)).toBe(10)
    })

    it('should handle tail-recursive functions', () => {
      // Factorial using trampoline
      const factorial = trampoline(function fact(
        n: number,
        acc: number = 1,
      ): number | (() => number) {
        if (n <= 1) {
          return acc as number
        }
        return (() => fact(n - 1, n * acc)) as any
      })

      expect(factorial(5)).toBe(120)
      expect(factorial(10)).toBe(3_628_800)
    })

    it('should handle tail-recursive sum', () => {
      const sum = trampoline(function sumN(
        n: number,
        acc: number = 0,
      ): number | (() => number) {
        if (n === 0) {
          return acc as number
        }
        return (() => sumN(n - 1, acc + n)) as any
      })

      expect(sum(5)).toBe(15) // 5 + 4 + 3 + 2 + 1
      expect(sum(10)).toBe(55) // 10 + 9 + ... + 1
      expect(sum(100)).toBe(5050)
    })

    it('should handle functions that return functions multiple levels deep', () => {
      const fn = trampoline((depth: number): number | (() => number) => {
        if (depth === 0) {
          return 0
        }
        return (() => () => () => fn(depth - 1)) as any
      })

      expect(fn(5)).toBe(0)
    })

    it('should preserve this context', () => {
      const context = {
        value: 10,
        countdown: trampoline(function (
          this: { value: number; countdown: any },
          n: number,
          acc: number = 0,
        ): number | (() => number) {
          if (n === 0) {
            return (acc + this.value) as number
          }
          return (() => this.countdown(n - 1, acc + n)) as any
        }),
      }

      expect(context.countdown(5)).toBe(25) // 5 + 4 + 3 + 2 + 1 + 10
    })

    it('should handle functions returning immediate results', () => {
      const fn = trampoline((x: number) => x + 1)
      expect(fn(5)).toBe(6)
    })

    it('should handle functions with multiple arguments', () => {
      const add = trampoline((a: number, b: number) => a + b)
      expect(add(3, 4)).toBe(7)
    })

    it('should handle tail-recursive fibonacci', () => {
      const fib = trampoline(function fibonacci(
        n: number,
        a: number = 0,
        b: number = 1,
      ): number | (() => number) {
        if (n === 0) {
          return a as number
        }
        if (n === 1) {
          return b as number
        }
        return (() => fibonacci(n - 1, b, a + b)) as any
      })

      expect(fib(0)).toBe(0)
      expect(fib(1)).toBe(1)
      expect(fib(5)).toBe(5)
      expect(fib(10)).toBe(55)
    })

    it('should handle functions returning functions that return values', () => {
      const fn = trampoline((x: number): number | (() => number) => {
        if (x === 0) {
          return 42
        }
        return (() => fn(x - 1)) as any
      })

      expect(fn(3)).toBe(42)
    })

    it('should unwind deep recursion safely', () => {
      // This would normally cause a stack overflow without trampoline
      const deepRecursion = trampoline(function deep(
        n: number,
      ): number | (() => number) {
        if (n === 0) {
          return 0
        }
        return (() => deep(n - 1)) as any
      })

      // Test with a large number that would normally overflow
      expect(deepRecursion(1000)).toBe(0)
    })

    it('should work with functions returning objects when not recursive', () => {
      const fn = trampoline(() => ({ value: 42 }))
      expect(fn()).toEqual({ value: 42 })
    })

    it('should handle empty parameter functions', () => {
      const fn = trampoline(() => 'result')
      expect(fn()).toBe('result')
    })
  })
})
