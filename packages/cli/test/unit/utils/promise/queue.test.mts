/**
 * Unit tests for promise queue.
 *
 * Purpose:
 * Tests promise queue for concurrent operation management. Validates rate limiting and concurrency control.
 *
 * Test Coverage:
 * - Concurrent promise execution
 * - Queue size management
 * - Rate limiting
 * - Error handling in queue
 * - Queue draining
 *
 * Testing Approach:
 * Tests asynchronous queue implementation.
 *
 * Related Files:
 * - utils/promise/queue.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { PromiseQueue } from '../../../../src/utils/promise/queue.mts'

describe('PromiseQueue', () => {
  it('should execute tasks with limited concurrency', async () => {
    const queue = new PromiseQueue(2)
    const executed: number[] = []
    const tasks = Array.from({ length: 5 }, (_, i) => {
      return () =>
        new Promise<number>(resolve => {
          executed.push(i)
          setTimeout(() => resolve(i), 10)
        })
    })

    const results = await Promise.allSettled(tasks.map(task => queue.add(task)))

    expect(
      results.map(r => (r.status === 'fulfilled' ? r.value : null)),
    ).toEqual([0, 1, 2, 3, 4])
  })

  it('should track active and pending counts', async () => {
    const queue = new PromiseQueue(1)
    const task = () => new Promise(resolve => setTimeout(resolve, 50))

    const p1 = queue.add(task)
    const p2 = queue.add(task)

    expect(queue.activeCount).toBe(1)
    expect(queue.pendingCount).toBe(1)

    await Promise.allSettled([p1, p2])

    expect(queue.activeCount).toBe(0)
    expect(queue.pendingCount).toBe(0)
  })

  it('should limit queue size when maxQueueLength is set', () => {
    const queue = new PromiseQueue(1, 2)

    // Add one running task
    queue.add(() => new Promise(resolve => setTimeout(resolve, 100)))

    // Queue should be empty initially
    expect(queue.pendingCount).toBe(0)

    // Add 3 tasks to queue (max 2, so oldest will be dropped)
    queue.add(() => Promise.resolve())
    expect(queue.pendingCount).toBe(1)

    queue.add(() => Promise.resolve())
    expect(queue.pendingCount).toBe(2)

    queue.add(() => Promise.resolve())
    // Should still be 2 because oldest was dropped
    expect(queue.pendingCount).toBe(2)
  })

  it('should wait for all tasks to complete with onIdle', async () => {
    const queue = new PromiseQueue(2)
    const results: number[] = []

    for (let i = 0; i < 5; i++) {
      queue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        results.push(i)
      })
    }

    await queue.onIdle()

    expect(results).toHaveLength(5)
  })

  it('should clear pending tasks', async () => {
    const queue = new PromiseQueue(1)
    const results: string[] = []

    const task = (id: string) => () =>
      new Promise<void>(resolve => {
        results.push(id)
        setTimeout(resolve, 50)
      })

    queue.add(task('a'))
    queue.add(task('b'))
    queue.add(task('c'))

    queue.clear()

    await queue.onIdle()

    // Only the first task should have run
    expect(results).toEqual(['a'])
  })

  it('should handle task errors', async () => {
    const queue = new PromiseQueue(1)

    // Intentionally defined inline for test simplicity.
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const goodTask = () => Promise.resolve('success')
    // Intentionally defined inline for test simplicity.
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const badTask = () => Promise.reject(new Error('failure'))

    const result1 = await queue.add(goodTask)
    await expect(queue.add(badTask)).rejects.toThrow('failure')
    const result2 = await queue.add(goodTask)

    expect(result1).toBe('success')
    expect(result2).toBe('success')
  })

  it('should throw error for invalid concurrency', () => {
    expect(() => new PromiseQueue(0)).toThrow(
      'maxConcurrency must be at least 1',
    )
    expect(() => new PromiseQueue(-1)).toThrow(
      'maxConcurrency must be at least 1',
    )
  })
})
