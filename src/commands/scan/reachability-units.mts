// Thin local mirror of the reachability unit grammar. Coana (@coana-tech/cli)
// is the canonical parser for these values; the Socket CLI forwards the raw
// string through verbatim and only performs this lightweight check so obvious
// mistakes fail fast before the Coana binary is spawned. Keep the patterns and
// help text in sync with Coana's grammar.

// --reach-analysis-timeout: a whole number optionally followed by s, m or h.
// Units are case-insensitive (matching Coana). A bare number is treated as
// seconds (back-compat, no longer documented).
const REACH_ANALYSIS_TIMEOUT_PATTERN = /^\d+(?:s|m|h)?$/i

// --reach-analysis-memory-limit: a whole number optionally followed by MB or GB.
// Units are case-insensitive (matching Coana). A bare number is treated as MB
// (back-compat, no longer documented).
const REACH_ANALYSIS_MEMORY_LIMIT_PATTERN = /^\d+(?:mb|gb)?$/i

export const REACH_ANALYSIS_MEMORY_LIMIT_HELP =
  'a whole number optionally followed by MB or GB (e.g. 512MB, 8GB)'

export const REACH_ANALYSIS_TIMEOUT_HELP =
  'a whole number optionally followed by s, m or h (e.g. 90s, 10m, 1h)'

// A zero-magnitude or empty value (e.g. "", "0", "0s", "0gb") means "use the
// default": the flag is omitted when forwarding and Coana applies its own
// default. This preserves the historical sentinel where a numeric 0 dropped the
// flag, and avoids Coana's undefined zero (0ms / 0MB) path.
export function isOmittedReachValue(value: string): boolean {
  const match = /^\d+/.exec(value)
  return !match || Number(match[0]) === 0
}

export function isValidReachAnalysisMemoryLimit(value: string): boolean {
  return value === '' || REACH_ANALYSIS_MEMORY_LIMIT_PATTERN.test(value)
}

export function isValidReachAnalysisTimeout(value: string): boolean {
  return value === '' || REACH_ANALYSIS_TIMEOUT_PATTERN.test(value)
}
