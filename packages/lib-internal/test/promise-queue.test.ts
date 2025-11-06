/**
 * @fileoverview Unit tests for concurrent promise queue utilities.
 *
 * Tests PromiseQueue class for controlled async concurrency:
 * - Constructor with configurable concurrency limit
 * - add() queues promises with automatic execution
 * - Concurrency control: limits parallel promise execution
 * - onEmpty(), onIdle() lifecycle events
 * - size, pending properties for queue state inspection
 * - Error handling: failed promises don't block queue
 * Used by Socket tools for rate-limited parallel operations (API calls, file I/O).
 */

import { PromiseQueue } from '@socketsecurity/lib/promise-queue'
import { describe, expect, it } from 'vitest'

// Helper to create a delayed promise
function delay(ms: number, value?: unknown): Promise<unknown> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

describe('PromiseQueue', () => {
  describe('constructor', () => {
    it('should create queue with valid concurrency', () => {
      expect(() => new PromiseQueue(1)).not.toThrow()
      expect(() => new PromiseQueue(5)).not.toThrow()
      expect(() => new PromiseQueue(100)).not.toThrow()
    })

    it('should throw error for invalid concurrency', () => {
      expect(() => new PromiseQueue(0)).toThrow(
        'maxConcurrency must be at least 1',
      )
      expect(() => new PromiseQueue(-1)).toThrow(
        'maxConcurrency must be at least 1',
      )
    })

    it('should accept maxQueueLength parameter', () => {
      expect(() => new PromiseQueue(1, 10)).not.toThrow()
      expect(() => new PromiseQueue(5, 100)).not.toThrow()
    })

    it('should work without maxQueueLength', () => {
      expect(() => new PromiseQueue(1)).not.toThrow()
      const queue = new PromiseQueue(2)
      expect(queue).toBeInstanceOf(PromiseQueue)
    })
  })

  describe('add', () => {
    it('should execute a single task', async () => {
      const queue = new PromiseQueue(1)
      const result = await queue.add(async () => 'test')
      expect(result).toBe('test')
    })

    it('should execute multiple tasks sequentially', async () => {
      const queue = new PromiseQueue(1)
      const results: number[] = []

      await Promise.all([
        queue.add(async () => {
          results.push(1)
          await delay(10)
          return 1
        }),
        queue.add(async () => {
          results.push(2)
          await delay(10)
          return 2
        }),
        queue.add(async () => {
          results.push(3)
          await delay(10)
          return 3
        }),
      ])

      expect(results).toEqual([1, 2, 3])
    })

    it('should execute tasks with concurrency limit', async () => {
      const queue = new PromiseQueue(2)
      let concurrent = 0
      let maxConcurrent = 0

      const task = async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await delay(50)
        concurrent--
        return concurrent
      }

      await Promise.all([
        queue.add(task),
        queue.add(task),
        queue.add(task),
        queue.add(task),
      ])

      expect(maxConcurrent).toBe(2)
    })

    it('should return task results', async () => {
      const queue = new PromiseQueue(2)
      const result1 = await queue.add(async () => 'result1')
      const result2 = await queue.add(async () => 42)
      const result3 = await queue.add(async () => ({ key: 'value' }))

      expect(result1).toBe('result1')
      expect(result2).toBe(42)
      expect(result3).toEqual({ key: 'value' })
    })

    it('should handle task errors', async () => {
      const queue = new PromiseQueue(1)
      await expect(
        queue.add(async () => {
          throw new Error('Task failed')
        }),
      ).rejects.toThrow('Task failed')
    })

    it('should continue processing after task error', async () => {
      const queue = new PromiseQueue(1)

      const p1 = queue
        .add(async () => {
          throw new Error('First fails')
        })
        .catch(e => e.message)

      const p2 = queue.add(async () => 'second succeeds')

      const results = await Promise.all([p1, p2])
      expect(results[0]).toBe('First fails')
      expect(results[1]).toBe('second succeeds')
    })
  })

  describe('maxQueueLength', () => {
    it('should drop oldest task when queue exceeds max length', async () => {
      const queue = new PromiseQueue(1, 2)
      const results: string[] = []
      const errors: Error[] = []

      // Add 4 tasks - first one runs immediately, next 2 queue, 4th drops oldest queued
      const tasks = [
        queue.add(async () => {
          await delay(50)
          results.push('task1')
          return 'task1'
        }),
        queue
          .add(async () => {
            results.push('task2')
            return 'task2'
          })
          .catch((e: Error) => errors.push(e)),
        queue.add(async () => {
          results.push('task3')
          return 'task3'
        }),
        queue.add(async () => {
          results.push('task4')
          return 'task4'
        }),
      ]

      await Promise.all(tasks.map(t => t.catch(() => {})))

      expect(errors.length).toBe(1)
      expect(errors[0]?.message).toBe('Task dropped: queue length exceeded')
      expect(results).toContain('task1')
      expect(results).not.toContain('task2') // Dropped
    })

    it('should work without dropping tasks when under limit', async () => {
      const queue = new PromiseQueue(1, 10)
      const results = await Promise.all([
        queue.add(async () => 1),
        queue.add(async () => 2),
        queue.add(async () => 3),
      ])

      expect(results).toEqual([1, 2, 3])
    })
  })

  describe('activeCount', () => {
    it('should return 0 for idle queue', () => {
      const queue = new PromiseQueue(1)
      expect(queue.activeCount).toBe(0)
    })

    it('should track running tasks', async () => {
      const queue = new PromiseQueue(2)

      const task1 = queue.add(async () => {
        await delay(50)
        return 'done'
      })

      // Give it a tick to start
      await delay(5)
      expect(queue.activeCount).toBeGreaterThan(0)

      await task1
      // Wait a bit for cleanup
      await delay(5)
      expect(queue.activeCount).toBe(0)
    })

    it('should not exceed maxConcurrency', async () => {
      const queue = new PromiseQueue(2)

      queue.add(async () => await delay(100))
      queue.add(async () => await delay(100))
      queue.add(async () => await delay(100))

      await delay(10)
      expect(queue.activeCount).toBeLessThanOrEqual(2)
    })
  })

  describe('pendingCount', () => {
    it('should return 0 for empty queue', () => {
      const queue = new PromiseQueue(1)
      expect(queue.pendingCount).toBe(0)
    })

    it('should track queued tasks', async () => {
      const queue = new PromiseQueue(1)

      queue.add(async () => await delay(100))
      queue.add(async () => await delay(10))
      queue.add(async () => await delay(10))

      await delay(10)
      expect(queue.pendingCount).toBeGreaterThan(0)
    })

    it('should decrease as tasks complete', async () => {
      const queue = new PromiseQueue(1)

      queue.add(async () => await delay(20))
      queue.add(async () => await delay(20))
      const task3 = queue.add(async () => await delay(20))

      await delay(5)
      const initialPending = queue.pendingCount

      await task3
      expect(queue.pendingCount).toBeLessThan(initialPending)
    })
  })

  describe('clear', () => {
    it('should clear pending tasks', async () => {
      const queue = new PromiseQueue(1)

      queue.add(async () => await delay(100))
      queue.add(async () => await delay(10))
      queue.add(async () => await delay(10))

      await delay(10)
      const beforeClear = queue.pendingCount

      queue.clear()
      expect(queue.pendingCount).toBe(0)
      expect(beforeClear).toBeGreaterThan(0)
    })

    it('should not affect running tasks', async () => {
      const queue = new PromiseQueue(1)
      let completed = false

      const runningTask = queue.add(async () => {
        await delay(50)
        completed = true
        return 'done'
      })

      await delay(10)
      queue.clear()

      const result = await runningTask
      expect(result).toBe('done')
      expect(completed).toBe(true)
    })

    it('should allow new tasks after clear', async () => {
      const queue = new PromiseQueue(2)

      queue.add(async () => await delay(50))
      queue.clear()

      const result = await queue.add(async () => 'new task')
      expect(result).toBe('new task')
    })
  })

  describe('onIdle', () => {
    it('should resolve immediately for empty queue', async () => {
      const queue = new PromiseQueue(1)
      await queue.onIdle()
      expect(true).toBe(true)
    })

    it('should wait for all tasks to complete', async () => {
      const queue = new PromiseQueue(2)
      const completed: number[] = []

      queue.add(async () => {
        await delay(30)
        completed.push(1)
      })
      queue.add(async () => {
        await delay(30)
        completed.push(2)
      })
      queue.add(async () => {
        await delay(30)
        completed.push(3)
      })

      await queue.onIdle()
      expect(completed).toEqual([1, 2, 3])
    })

    it('should work with sequential calls', async () => {
      const queue = new PromiseQueue(1)

      queue.add(async () => await delay(20))
      await queue.onIdle()

      queue.add(async () => await delay(20))
      await queue.onIdle()

      expect(queue.activeCount).toBe(0)
      expect(queue.pendingCount).toBe(0)
    })
  })

  describe('integration', () => {
    it('should handle complex workflow', async () => {
      const queue = new PromiseQueue(3, 50)
      const results: number[] = []

      // Add many tasks - use larger queue to avoid dropping
      const tasks = Array.from({ length: 20 }, (_, i) =>
        queue.add(async () => {
          await delay(Math.random() * 20)
          results.push(i)
          return i
        }),
      )

      await Promise.all(tasks)

      expect(results.length).toBe(20)
      // Wait a bit for cleanup
      await delay(5)
      expect(queue.activeCount).toBe(0)
      expect(queue.pendingCount).toBe(0)
    })

    it('should handle mixed success and failure', async () => {
      const queue = new PromiseQueue(2)
      const results = await Promise.allSettled([
        queue.add(async () => 'success'),
        queue.add(async () => {
          throw new Error('fail')
        }),
        queue.add(async () => 'success2'),
        queue.add(async () => {
          throw new Error('fail2')
        }),
      ])

      const fulfilled = results.filter(r => r.status === 'fulfilled')
      const rejected = results.filter(r => r.status === 'rejected')

      expect(fulfilled.length).toBe(2)
      expect(rejected.length).toBe(2)
    })

    it('should maintain order for sequential execution', async () => {
      const queue = new PromiseQueue(1)
      const order: number[] = []

      await Promise.all([
        queue.add(async () => order.push(1)),
        queue.add(async () => order.push(2)),
        queue.add(async () => order.push(3)),
        queue.add(async () => order.push(4)),
      ])

      expect(order).toEqual([1, 2, 3, 4])
    })

    it('should work with different data types', async () => {
      const queue = new PromiseQueue(2)

      const [str, num, obj, arr, bool] = await Promise.all([
        queue.add(async () => 'string'),
        queue.add(async () => 42),
        queue.add(async () => ({ key: 'value' })),
        queue.add(async () => [1, 2, 3]),
        queue.add(async () => true),
      ])

      expect(str).toBe('string')
      expect(num).toBe(42)
      expect(obj).toEqual({ key: 'value' })
      expect(arr).toEqual([1, 2, 3])
      expect(bool).toBe(true)
    })
  })
})
