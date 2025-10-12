/** @fileoverview Performance monitoring utilities for Socket CLI. Provides timing, profiling, and performance metric collection for identifying bottlenecks. */

import { debugNs } from './debug.mts'

/**
 * Performance metrics collected during CLI execution.
 */
type PerformanceMetrics = {
  operation: string
  duration: number
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * Global metrics collection (only in debug mode).
 */
const performanceMetrics: PerformanceMetrics[] = []

/**
 * Check if performance tracking is enabled.
 */
function isPerfEnabled(): boolean {
  return process.env['DEBUG']?.includes('perf') || false
}

/**
 * Start a performance timer for an operation.
 * Returns a stop function that records the duration.
 *
 * @param operation - Name of the operation being timed
 * @param metadata - Optional metadata to attach to the metric
 * @returns Stop function that completes the timing
 *
 * @example
 * const stop = perfTimer('api-call')
 * await fetchData()
 * stop({ endpoint: '/npm/lodash/score' })
 */
export function perfTimer(
  operation: string,
  metadata?: Record<string, unknown>,
): (additionalMetadata?: Record<string, unknown>) => void {
  if (!isPerfEnabled()) {
    // No-op if perf tracking disabled
    return () => {}
  }

  const start = performance.now()
  debugNs('perf', `[START] ${operation}`)

  return (additionalMetadata?: Record<string, unknown>) => {
    const duration = performance.now() - start
    const metric: PerformanceMetrics = {
      operation,
      duration: Math.round(duration * 100) / 100, // Round to 2 decimals
      timestamp: Date.now(),
      metadata: { ...metadata, ...additionalMetadata },
    }

    performanceMetrics.push(metric)
    debugNs('perf', `[END] ${operation} - ${metric.duration}ms`)
  }
}

/**
 * Measure execution time of an async function.
 *
 * @param operation - Name of the operation
 * @param fn - Async function to measure
 * @param metadata - Optional metadata
 * @returns Result of the function and duration
 *
 * @example
 * const { result, duration } = await measure('fetch-packages', async () => {
 *   return await fetchPackages()
 * })
 * console.log(`Fetched packages in ${duration}ms`)
 */
export async function measure<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<{ result: T; duration: number }> {
  const stop = perfTimer(operation, metadata)

  try {
    const result = await fn()
    stop({ success: true })

    const metric = performanceMetrics[performanceMetrics.length - 1]
    return { result, duration: metric?.duration || 0 }
  } catch (error) {
    stop({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    throw error
  }
}

/**
 * Measure synchronous function execution time.
 *
 * @param operation - Name of the operation
 * @param fn - Synchronous function to measure
 * @param metadata - Optional metadata
 * @returns Result of the function and duration
 *
 * @example
 * const { result, duration } = measureSync('parse-json', () => {
 *   return JSON.parse(data)
 * })
 */
export function measureSync<T>(
  operation: string,
  fn: () => T,
  metadata?: Record<string, unknown>,
): { result: T; duration: number } {
  const stop = perfTimer(operation, metadata)

  try {
    const result = fn()
    stop({ success: true })

    const metric = performanceMetrics[performanceMetrics.length - 1]
    return { result, duration: metric?.duration || 0 }
  } catch (error) {
    stop({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown',
    })
    throw error
  }
}

/**
 * Get all collected performance metrics.
 * Only available when DEBUG=perf is enabled.
 *
 * @returns Array of performance metrics
 */
export function getPerformanceMetrics(): PerformanceMetrics[] {
  return [...performanceMetrics]
}

/**
 * Clear all collected performance metrics.
 */
export function clearPerformanceMetrics(): void {
  performanceMetrics.length = 0
  debugNs('perf', 'Cleared performance metrics')
}

/**
 * Get performance summary statistics.
 *
 * @returns Summary of metrics grouped by operation
 *
 * @example
 * const summary = getPerformanceSummary()
 * console.log(summary)
 * // {
 * //   'api-call': { count: 5, total: 1234, avg: 246.8, min: 100, max: 500 },
 * //   'file-read': { count: 10, total: 50, avg: 5, min: 2, max: 15 }
 * // }
 */
export function getPerformanceSummary(): Record<
  string,
  {
    count: number
    total: number
    avg: number
    min: number
    max: number
  }
> {
  const summary: Record<
    string,
    { count: number; total: number; min: number; max: number }
  > = Object.create(null)

  for (const metric of performanceMetrics) {
    const { operation, duration } = metric

    if (!summary[operation]) {
      summary[operation] = {
        count: 0,
        total: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      }
    }

    const stats = summary[operation]!
    stats.count++
    stats.total += duration
    stats.min = Math.min(stats.min, duration)
    stats.max = Math.max(stats.max, duration)
  }

  // Calculate averages and return with proper typing
  const result: Record<
    string,
    { count: number; total: number; avg: number; min: number; max: number }
  > = Object.create(null)

  for (const [operation, stats] of Object.entries(summary)) {
    result[operation] = {
      count: stats.count,
      total: Math.round(stats.total * 100) / 100,
      avg: Math.round((stats.total / stats.count) * 100) / 100,
      min: Math.round(stats.min * 100) / 100,
      max: Math.round(stats.max * 100) / 100,
    }
  }

  return result
}

/**
 * Print performance summary to console.
 * Only prints when DEBUG=perf is enabled.
 *
 * @example
 * printPerformanceSummary()
 * // Performance Summary:
 * // api-call: 5 calls, avg 246.8ms (min 100ms, max 500ms, total 1234ms)
 * // file-read: 10 calls, avg 5ms (min 2ms, max 15ms, total 50ms)
 */
export function printPerformanceSummary(): void {
  if (!isPerfEnabled() || performanceMetrics.length === 0) {
    return
  }

  const summary = getPerformanceSummary()
  const operations = Object.keys(summary).sort()

  debugNs('perf', '\n=== Performance Summary ===')

  for (const operation of operations) {
    const stats = summary[operation]!
    debugNs(
      'perf',
      `${operation}: ${stats.count} calls, avg ${stats.avg}ms (min ${stats.min}ms, max ${stats.max}ms, total ${stats.total}ms)`,
    )
  }

  debugNs('perf', '=========================\n')
}

/**
 * Mark a checkpoint in performance tracking.
 * Useful for tracking progress through complex operations.
 *
 * @param checkpoint - Name of the checkpoint
 * @param metadata - Optional metadata
 *
 * @example
 * perfCheckpoint('start-scan')
 * // ... do work ...
 * perfCheckpoint('fetch-packages', { count: 50 })
 * // ... do work ...
 * perfCheckpoint('analyze-issues', { issueCount: 10 })
 * perfCheckpoint('end-scan')
 */
export function perfCheckpoint(
  checkpoint: string,
  metadata?: Record<string, unknown>,
): void {
  if (!isPerfEnabled()) {
    return
  }

  const metric: PerformanceMetrics = {
    operation: `checkpoint:${checkpoint}`,
    duration: 0,
    timestamp: Date.now(),
    ...(metadata ? { metadata } : {}),
  }

  performanceMetrics.push(metric)
  debugNs('perf', `[CHECKPOINT] ${checkpoint}`)
}

/**
 * Track memory usage at a specific point.
 * Only available when DEBUG=perf is enabled.
 *
 * @param label - Label for this memory snapshot
 * @returns Memory usage in MB
 *
 * @example
 * const memBefore = trackMemory('before-operation')
 * await heavyOperation()
 * const memAfter = trackMemory('after-operation')
 * console.log(`Memory increased by ${memAfter - memBefore}MB`)
 */
export function trackMemory(label: string): number {
  if (!isPerfEnabled()) {
    return 0
  }

  const usage = process.memoryUsage()
  const heapUsedMB = Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100

  debugNs('perf', `[MEMORY] ${label}: ${heapUsedMB}MB heap used`)

  const metric: PerformanceMetrics = {
    operation: `checkpoint:memory:${label}`,
    duration: 0,
    timestamp: Date.now(),
    metadata: {
      heapUsed: heapUsedMB,
      heapTotal: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
      external: Math.round((usage.external / 1024 / 1024) * 100) / 100,
    },
  }

  performanceMetrics.push(metric)

  return heapUsedMB
}

/**
 * Create a performance report for the current execution.
 * Only available when DEBUG=perf is enabled.
 *
 * @returns Formatted performance report
 */
export function generatePerformanceReport(): string {
  if (!isPerfEnabled() || performanceMetrics.length === 0) {
    return '(no performance data collected - enable with DEBUG=perf)'
  }

  const summary = getPerformanceSummary()
  const operations = Object.keys(summary).sort()

  let report = '\n╔═══════════════════════════════════════════════╗\n'
  report += '║         Performance Report                    ║\n'
  report += '╚═══════════════════════════════════════════════╝\n\n'

  for (const operation of operations) {
    const stats = summary[operation]!
    report += `${operation}:\n`
    report += `  Calls: ${stats.count}\n`
    report += `  Avg:   ${stats.avg}ms\n`
    report += `  Min:   ${stats.min}ms\n`
    report += `  Max:   ${stats.max}ms\n`
    report += `  Total: ${stats.total}ms\n\n`
  }

  const totalDuration = Object.values(summary).reduce(
    (sum, s) => sum + s.total,
    0,
  )
  report += `Total measured time: ${Math.round(totalDuration * 100) / 100}ms\n`

  return report
}
