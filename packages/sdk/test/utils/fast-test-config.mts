/** @fileoverview Fast test configuration to speed up tests that use retry logic. */

/**
 * Fast test configuration that reduces delays and timeouts.
 * Use this for all tests unless specifically testing timeout/retry behavior.
 */
export const FAST_TEST_CONFIG = {
  retries: 5,
  // 10ms instead of default 1000ms
  retryDelay: 10,
  timeout: 5000,
}

/**
 * Minimal retry configuration for tests that need to verify retries happen.
 * Total time with exponential backoff: 10 + 20 + 40 = 70ms for 3 retries.
 */
export const MINIMAL_RETRY_CONFIG = {
  retries: 3,
  retryDelay: 10,
  timeout: 5000,
}

/**
 * No retry configuration for tests that should fail immediately.
 */
export const NO_RETRY_CONFIG = {
  retries: 0,
  retryDelay: 10,
  timeout: 5000,
}
