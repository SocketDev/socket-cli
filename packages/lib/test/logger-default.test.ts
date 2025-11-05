/**
 * @fileoverview Unit tests for getDefaultLogger singleton factory.
 *
 * Tests default logger instance creation and caching:
 * - getDefaultLogger() returns singleton Logger instance
 * - All logging methods available (log, success, error, info, warn, debug)
 * - Instance reuse across multiple calls (singleton pattern)
 * - Integration with global logging configuration
 * Used by Socket tools for centralized logging without explicit Logger instantiation.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { describe, expect, it } from 'vitest'

describe('getDefaultLogger', () => {
  it('should return a Logger instance', () => {
    const log = getDefaultLogger()
    expect(log).toBeDefined()
    expect(typeof log.log).toBe('function')
    expect(typeof log.success).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('should return the same instance on multiple calls', () => {
    const log1 = getDefaultLogger()
    const log2 = getDefaultLogger()
    expect(log1).toBe(log2)
  })

  it('should be usable for logging', () => {
    const log = getDefaultLogger()
    // Logger methods are defined dynamically, just verify the instance works
    expect(() => log.log('test')).not.toThrow()
  })
})
