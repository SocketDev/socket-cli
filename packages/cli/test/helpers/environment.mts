/** @fileoverview Test environment setup utilities for Socket CLI. Provides consistent test environment configuration including mock clearing and process state management. */

import { afterEach, beforeEach, vi } from 'vitest'

/**
 * Setup standard test environment with beforeEach hook
 * Clears all mocks and resets process.exitCode
 */
export function setupTestEnvironment(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })
}

/**
 * Reset process.exitCode manually
 */
export function resetExitCode(): void {
  process.exitCode = undefined
}

/**
 * Clear all mocks manually
 */
export function clearAllMocks(): void {
  vi.clearAllMocks()
}

/**
 * Setup and cleanup for a test with custom initialization
 */
export function setupTestWithCleanup(
  setup?: () => void | Promise<void>,
  cleanup?: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.exitCode = undefined
    if (setup) {
      await setup()
    }
  })

  if (cleanup) {
    afterEach(async () => {
      await cleanup()
    })
  }
}
