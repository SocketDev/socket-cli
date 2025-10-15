/** @fileoverview Standard mock setup utilities for Socket CLI tests. Provides reusable mock configurations for SDK, logger, output utilities, and debug functions. */

import { vi } from 'vitest'

/**
 * Setup standard SDK and API mocks
 * Use this for tests that need to mock SDK setup and API calls
 */
export function setupStandardSdkMocks() {
  vi.mock('../../utils/socket/api.mjs', () => ({
    handleApiCall: vi.fn(),
  }))

  vi.mock('../../utils/socket/sdk.mjs', () => ({
    setupSdk: vi.fn(),
    withSdk: vi.fn(),
  }))
}

/**
 * Setup standard output utility mocks
 * Use this for output-*.test.mts files
 */
export function setupStandardOutputMocks() {
  vi.mock('@socketsecurity/registry/lib/logger', () => ({
    logger: {
      fail: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
  }))

  vi.mock('../../utils/error/fail-msg-with-badge.mts', () => ({
    failMsgWithBadge: vi.fn((msg, cause) => `${msg}: ${cause}`),
  }))

  vi.mock('../../utils/output/result-json.mjs', () => ({
    serializeResultJson: vi.fn(result => JSON.stringify(result)),
  }))
}

/**
 * Setup output mocks with additional table formatting
 * Use this for output files that render tables
 */
export function setupOutputWithTableMocks() {
  setupStandardOutputMocks()

  vi.mock('../../utils/output/markdown.mts', () => ({
    mdTableOfPairs: vi.fn(pairs => `Table with ${pairs.length} rows`),
  }))
}

/**
 * Setup debug utility mocks
 * Use this for handle-*.test.mts files
 */
export function setupDebugMocks() {
  vi.mock('../../utils/debug.mts', () => ({
    debugDir: vi.fn(),
    debugFn: vi.fn(),
    debugLog: vi.fn(),
    isDebug: vi.fn(() => false),
  }))
}

/**
 * Setup combined mocks for handle functions
 * Use this for handle-*.test.mts files that orchestrate fetch + output
 */
export function setupHandleFunctionMocks() {
  setupStandardSdkMocks()
  setupDebugMocks()
}
