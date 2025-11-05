/**
 * @fileoverview Tests for PromiseQueue utility class
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PromiseQueue } from '../src/promise-queue'

describe('PromiseQueue', () => {
  let queue: PromiseQueue

  beforeEach(() => {
    queue = new PromiseQueue(2)
  })

  afterEach(() => {
    queue.clear()
  })

  describe('Constructor', () => {
    it('should throw error when maxConcurrency is less than 1', () => {
      expect(() => new PromiseQueue(0)).toThrow(
        'maxConcurrency must be at least 1',
      )
    })

    it('should create queue with valid maxConcurrency', () => {
      const validQueue = new PromiseQueue(5)
      expect(validQueue.activeCount).toBe(0)
      expect(validQueue.pendingCount).toBe(0)
    })

    it('should create queue with maxQueueLength', () => {
      const limitedQueue = new PromiseQueue(2, 10)
      expect(limitedQueue.pendingCount).toBe(0)
    })
  })

  describe('Task Execution', () => {
    it('should resolve tasks with correct values', async () => {
      const result = await queue.add(async () => {
        return 'test-value'
      })

      expect(result).toBe('test-value')
    })

    it('should reject tasks that throw errors', async () => {
      const errorMessage = 'Task failed'
      await expect(
        queue.add(async () => {
          throw new Error(errorMessage)
        }),
      ).rejects.toThrow(errorMessage)
    })

    it('should continue processing after task error', async () => {
      const task1 = queue.add(async () => {
        throw new Error('First task failed')
      })

      const task2 = queue.add(async () => {
        return 'success'
      })

      await expect(task1).rejects.toThrow('First task failed')
      await expect(task2).resolves.toBe('success')
    })
  })

  describe('onIdle', () => {
    it('should resolve immediately when queue is empty', async () => {
      await expect(queue.onIdle()).resolves.toBeUndefined()
    })
  })

  describe.sequential('Max Queue Length', () => {
    it('should drop oldest tasks when queue is full', async () => {
      const limitedQueue = new PromiseQueue(1, 2)
      const completed: number[] = []

      // Add first task that will run immediately
      limitedQueue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        completed.push(1)
        return 1
      })

      // Give task1 time to start
      await new Promise(resolve => setTimeout(resolve, 10))

      // Task2 will be queued
      limitedQueue.add(async () => {
        completed.push(2)
        return 2
      })

      // Task3 will be queued (queue has 2 items: task2, task3)
      limitedQueue.add(async () => {
        completed.push(3)
        return 3
      })

      // Task4 will cause task2 to be dropped (queue is full at maxQueueLength=2)
      limitedQueue.add(async () => {
        completed.push(4)
        return 4
      })

      // Wait for all running and queued tasks to complete
      await limitedQueue.onIdle()

      // Only 3 tasks should have completed (task2 was dropped)
      expect(completed).toContain(1)
      // Task2 was dropped
      expect(completed).not.toContain(2)
      expect(completed).toContain(3)
      expect(completed).toContain(4)
      expect(completed.length).toBe(3)
    })

    it('should maintain queue length at max', async () => {
      const limitedQueue = new PromiseQueue(1, 3)

      limitedQueue.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 1
      })
      limitedQueue.add(async () => 2)
      limitedQueue.add(async () => 3)
      limitedQueue.add(async () => 4)

      // Wait for first task to start
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(limitedQueue.pendingCount).toBeLessThanOrEqual(3)
    })
  })

  describe.sequential('Complex Scenarios', () => {
    it('should handle multiple concurrent queues', async () => {
      const queue1 = new PromiseQueue(2)
      const queue2 = new PromiseQueue(2)

      const results1: number[] = []
      const results2: number[] = []

      const promises1 = [1, 2, 3].map(n =>
        queue1.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 20))
          results1.push(n)
          return n
        }),
      )

      const promises2 = [4, 5, 6].map(n =>
        queue2.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 20))
          results2.push(n)
          return n
        }),
      )

      await Promise.all([...promises1, ...promises2])
      expect(results1).toEqual([1, 2, 3])
      expect(results2).toEqual([4, 5, 6])
    })

    it('should handle rapid task additions', async () => {
      const results: number[] = []
      const promises = Array.from({ length: 20 }, (_, i) =>
        queue.add(async () => {
          results.push(i)
          return i
        }),
      )

      await Promise.all(promises)
      expect(results).toHaveLength(20)
    })

    it('should handle tasks with varying completion times', async () => {
      const results: string[] = []

      await Promise.all([
        queue.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 50))
          results.push('slow')
          return 'slow'
        }),
        queue.add(async () => {
          results.push('fast')
          return 'fast'
        }),
        queue.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 25))
          results.push('medium')
          return 'medium'
        }),
      ])

      expect(results).toContain('slow')
      expect(results).toContain('fast')
      expect(results).toContain('medium')
      expect(results).toHaveLength(3)
    })
  })
})
