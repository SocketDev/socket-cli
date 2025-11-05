/**
 * Time-related constants including cache TTLs and timeouts.
 */

// Time unit multipliers (milliseconds).
export const MILLISECONDS_PER_SECOND = 1000
export const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND
export const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE
export const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR

// Cache TTL values.
// DLX binary cache expires after 7 days.
export const DLX_BINARY_CACHE_TTL = 7 * MILLISECONDS_PER_DAY
