/** @fileoverview Test environment setup and cleanup utilities. */
import nock from 'nock'
import { afterEach, beforeEach } from 'vitest'

import { FAST_TEST_CONFIG } from './fast-test-config.mts'
import { SocketSdk } from '../../src/index'

// Check if running in coverage mode
// This is set in vitest.config.mts when coverage is enabled
export const isCoverageMode = process.env['COVERAGE'] === 'true'

export function setupTestEnvironment() {
  beforeEach(() => {
    nock.restore()
    nock.cleanAll()
    nock.activate()
    nock.disableNetConnect()

    // In coverage mode (singleThread: true), be extra aggressive about cleanup
    // to prevent nock mock state bleeding between tests
    if (isCoverageMode) {
      nock.abortPendingRequests()
      // Clear any lingering interceptors
      nock.cleanAll()
    }
  })

  afterEach(() => {
    // In coverage mode, be aggressive about cleanup to prevent state bleeding
    if (isCoverageMode) {
      nock.abortPendingRequests()
    }

    // Skip strict pending mock checks in coverage mode
    // The singleThread execution can cause timing issues with nock.isDone()
    if (!isCoverageMode && !nock.isDone()) {
      throw new Error(`pending nock mocks: ${nock.pendingMocks()}`)
    }
    nock.cleanAll()
    nock.restore()
  })
}

/**
 * Create a test client with a standard token.
 *
 * @param token - Optional API token (default: 'test-api-token')
 * @param options - Optional SDK configuration
 * @returns SocketSdk instance for testing
 *
 * @example
 * ```ts
 * describe('My tests', () => {
 *   let client: SocketSdk
 *   beforeEach(() => { client = createTestClient() })
 * })
 * ```
 */
export function createTestClient(
  token = 'test-api-token',
  options?: ConstructorParameters<typeof SocketSdk>[1],
): SocketSdk {
  return new SocketSdk(token, { ...FAST_TEST_CONFIG, ...options })
}

/**
 * Setup test environment with nock and create a test client.
 * This is a convenience function that combines setupTestEnvironment and client creation.
 *
 * @param token - Optional API token (default: 'test-api-token')
 * @param options - Optional SDK configuration
 * @returns Function that returns the current test client
 *
 * @example
 * ```ts
 * describe('My tests', () => {
 *   const getClient = setupTestClient({ retries: 0 })
 *
 *   it('should work', async () => {
 *     const client = getClient()
 *     // ... test code
 *   })
 * })
 * ```
 */
export function setupTestClient(
  token = 'test-api-token',
  options?: ConstructorParameters<typeof SocketSdk>[1],
): () => SocketSdk {
  let client: SocketSdk

  setupTestEnvironment()

  beforeEach(() => {
    client = createTestClient(token, options)
  })

  return () => client
}

/**
 * Setup nock environment with standard beforeEach/afterEach hooks.
 * Handles nock activation, cleanup, and pending mock detection.
 */
export function setupNockEnvironment() {
  beforeEach(() => {
    nock.restore()
    nock.cleanAll()
    nock.activate()
    nock.disableNetConnect()

    // In coverage mode, be extra aggressive about cleanup
    if (isCoverageMode) {
      nock.abortPendingRequests()
      nock.cleanAll()
    }
  })

  afterEach(() => {
    // In coverage mode, be aggressive about cleanup
    if (isCoverageMode) {
      nock.abortPendingRequests()
    }

    // Skip strict pending mock checks in coverage mode
    if (!isCoverageMode && !nock.isDone()) {
      throw new Error(`pending nock mocks: ${nock.pendingMocks()}`)
    }
    nock.cleanAll()
    nock.restore()
  })
}

// Handle unhandled rejections in tests.
process.on('unhandledRejection', cause => {
  const error = new Error('Unhandled rejection', { cause })
  throw error
})
