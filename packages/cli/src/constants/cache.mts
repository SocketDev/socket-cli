/**
 * Caching, TTL, and timeout constants for Socket CLI.
 */

// Cache TTL (Time To Live) in milliseconds
export const DLX_BINARY_CACHE_TTL = 7 * 24 * 60 * 60 * 1_000 // 7 days
export const UPDATE_CHECK_TTL = 24 * 60 * 60 * 1_000 // 24 hours

// Timeouts in milliseconds
export const UPDATE_NOTIFIER_TIMEOUT = 10_000 // 10 seconds
