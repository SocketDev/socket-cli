/**
 * @file Test environment setup utilities for Socket CLI. Provides consistent
 *   test environment configuration including mock clearing and process state
 *   management.
 */

import { beforeEach, vi } from 'vitest'

/**
 * Clear all mocks manually.
 */
export function clearAllMocks(): void {
  vi.clearAllMocks()
}

/**
 * Setup standard test environment with beforeEach hook Clears all mocks and
 * resets process.exitCode.
 */
export function setupTestEnvironment(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })
}
