/** @fileoverview Tests for performance monitoring utilities. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearPerformanceMetrics,
  generatePerformanceReport,
  getPerformanceMetrics,
  getPerformanceSummary,
  measure,
  measureSync,
  perfCheckpoint,
  perfTimer,
  trackMemory,
} from '../../../src/utils/performance.mts'

describe('performance utilities', () => {
  beforeEach(() => {
    clearPerformanceMetrics()
    // Enable perf tracking for tests
    vi.stubEnv('DEBUG', 'perf')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    clearPerformanceMetrics()
  })

  describe('perfTimer', () => {
    it('should record timing for an operation', async () => {
      const stop = perfTimer('test-operation')
      await new Promise(resolve => setTimeout(resolve, 10))
      stop()

      const metrics = getPerformanceMetrics()
      expect(metrics).toHaveLength(1)
      expect(metrics[0]?.operation).toBe('test-operation')
      expect(metrics[0]?.duration).toBeGreaterThan(0)
    })

    it('should include metadata', () => {
      const stop = perfTimer('test-op', { foo: 'bar' })
      stop({ baz: 'qux' })

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.metadata).toEqual({ foo: 'bar', baz: 'qux' })
    })

    it('should be no-op when DEBUG=perf is not set', () => {
      vi.stubEnv('DEBUG', 'other')

      const stop = perfTimer('test-operation')
      stop()

      const metrics = getPerformanceMetrics()
      expect(metrics).toHaveLength(0)
    })
  })

  describe('measure', () => {
    it('should measure async function execution', async () => {
      const { duration, result } = await measure('async-op', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'success'
      })

      expect(result).toBe('success')
      expect(duration).toBeGreaterThan(0)
    })

    it('should record success in metadata', async () => {
      await measure('async-op', async () => 'done')

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.metadata?.success).toBe(true)
    })

    it('should record error in metadata and rethrow', async () => {
      await expect(
        measure('async-op', async () => {
          throw new Error('test error')
        }),
      ).rejects.toThrow('test error')

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.metadata?.success).toBe(false)
      expect(metrics[0]?.metadata?.error).toBe('test error')
    })
  })

  describe('measureSync', () => {
    it('should measure sync function execution', () => {
      const { duration, result } = measureSync('sync-op', () => {
        let sum = 0
        for (let i = 0; i < 1000; i++) {
          sum += i
        }
        return sum
      })

      expect(result).toBe(499500)
      expect(duration).toBeGreaterThanOrEqual(0)
    })

    it('should record success in metadata', () => {
      measureSync('sync-op', () => 'done')

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.metadata?.success).toBe(true)
    })

    it('should record error in metadata and rethrow', () => {
      expect(() => {
        measureSync('sync-op', () => {
          throw new Error('sync error')
        })
      }).toThrow('sync error')

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.metadata?.success).toBe(false)
      expect(metrics[0]?.metadata?.error).toBe('sync error')
    })
  })

  describe('getPerformanceMetrics', () => {
    it('should return all collected metrics', () => {
      const stop1 = perfTimer('op1')
      stop1()
      const stop2 = perfTimer('op2')
      stop2()

      const metrics = getPerformanceMetrics()
      expect(metrics).toHaveLength(2)
      expect(metrics[0]?.operation).toBe('op1')
      expect(metrics[1]?.operation).toBe('op2')
    })

    it('should return a copy of metrics array', () => {
      const stop = perfTimer('op1')
      stop()

      const metrics1 = getPerformanceMetrics()
      const metrics2 = getPerformanceMetrics()

      expect(metrics1).toEqual(metrics2)
      expect(metrics1).not.toBe(metrics2)
    })
  })

  describe('clearPerformanceMetrics', () => {
    it('should clear all metrics', () => {
      const stop = perfTimer('op1')
      stop()
      expect(getPerformanceMetrics()).toHaveLength(1)

      clearPerformanceMetrics()
      expect(getPerformanceMetrics()).toHaveLength(0)
    })
  })

  describe('getPerformanceSummary', () => {
    it('should summarize metrics by operation', () => {
      const stop1 = perfTimer('api-call')
      stop1()
      const stop2 = perfTimer('api-call')
      stop2()
      const stop3 = perfTimer('file-read')
      stop3()

      const summary = getPerformanceSummary()

      expect(summary['api-call']).toBeDefined()
      expect(summary['api-call']?.count).toBe(2)
      expect(summary['file-read']).toBeDefined()
      expect(summary['file-read']?.count).toBe(1)
    })

    it('should calculate correct statistics', () => {
      // Manually add metrics with known durations
      const stop1 = perfTimer('op')
      setTimeout(() => {}, 0)
      stop1()
      const stop2 = perfTimer('op')
      setTimeout(() => {}, 0)
      stop2()

      const summary = getPerformanceSummary()
      const stats = summary['op']!

      expect(stats.count).toBe(2)
      expect(stats.total).toBeGreaterThan(0)
      // Average should be close to total/count (within rounding tolerance)
      expect(Math.abs(stats.avg - stats.total / stats.count)).toBeLessThan(0.01)
      expect(stats.min).toBeGreaterThanOrEqual(0)
      expect(stats.max).toBeGreaterThanOrEqual(stats.min)
    })
  })

  describe('perfCheckpoint', () => {
    it('should record checkpoint with metadata', () => {
      perfCheckpoint('start', { phase: 'init' })

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.operation).toBe('checkpoint:start')
      expect(metrics[0]?.duration).toBe(0)
      expect(metrics[0]?.metadata?.phase).toBe('init')
    })

    it('should be no-op when DEBUG=perf is not set', () => {
      vi.stubEnv('DEBUG', 'other')

      perfCheckpoint('test')

      const metrics = getPerformanceMetrics()
      expect(metrics).toHaveLength(0)
    })
  })

  describe('trackMemory', () => {
    it('should track memory usage', () => {
      const memUsed = trackMemory('test-point')

      expect(memUsed).toBeGreaterThan(0)

      const metrics = getPerformanceMetrics()
      expect(metrics[0]?.operation).toBe('checkpoint:memory:test-point')
      expect(metrics[0]?.metadata?.heapUsed).toBe(memUsed)
    })

    it('should be no-op when DEBUG=perf is not set', () => {
      vi.stubEnv('DEBUG', 'other')

      const memUsed = trackMemory('test')

      expect(memUsed).toBe(0)
      expect(getPerformanceMetrics()).toHaveLength(0)
    })
  })

  describe('generatePerformanceReport', () => {
    it('should generate formatted report', () => {
      const stop1 = perfTimer('operation-a')
      stop1()
      const stop2 = perfTimer('operation-b')
      stop2()

      const report = generatePerformanceReport()

      expect(report).toContain('Performance Report')
      expect(report).toContain('operation-a')
      expect(report).toContain('operation-b')
      expect(report).toContain('Calls:')
      expect(report).toContain('Avg:')
      expect(report).toContain('Total measured time:')
    })

    it('should return message when no data collected', () => {
      vi.stubEnv('DEBUG', 'other')

      const report = generatePerformanceReport()
      expect(report).toContain('no performance data collected')
    })

    it('should return message when perf tracking disabled', () => {
      const report = generatePerformanceReport()
      expect(report).toContain('no performance data collected')
    })
  })
})
