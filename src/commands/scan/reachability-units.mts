// Helpers for the reachability unit values. Coana (@coana-tech/cli) is the sole
// validator/parser of these values; the Socket CLI forwards the raw string
// through verbatim. These helpers do NOT validate grammar (that would duplicate
// Coana's and drift): they only handle the meow-default sentinel and detect
// whether a value differs from the default, neither of which Coana models.

// A zero-magnitude or empty value (e.g. "", "0", "0s", "0gb") means "use the
// default": the flag is omitted when forwarding and Coana applies its own
// default. This preserves the historical sentinel where a numeric 0 dropped the
// flag, and avoids Coana's undefined zero (0ms / 0MB) path.
export function isOmittedReachValue(value: string): boolean {
  const match = /^\d+/.exec(value)
  return !match || Number(match[0]) === 0
}

// Resolve a memory-limit value to its magnitude in MB (the unit Coana uses), or
// null when the value is omitted/zero (Coana then applies its own default).
// Used only to compare a value against the default regardless of how the unit
// is written: 8192, 8192MB and 8GB all resolve to 8192. This is default
// detection, not validation, so an unrecognized value resolves to null and is
// simply treated as "not a non-default value".
export function reachMemoryLimitToMb(value: string): number | null {
  if (isOmittedReachValue(value)) {
    return null
  }
  const match = /^(\d+)(mb|gb)?$/i.exec(value)
  if (!match) {
    return null
  }
  const amount = Number(match[1])
  return match[2]?.toLowerCase() === 'gb' ? amount * 1024 : amount
}
