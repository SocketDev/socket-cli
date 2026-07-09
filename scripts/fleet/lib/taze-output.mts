/**
 * Parse taze output for version-lookup failures.
 *
 * Taze resolves versions through fast-npm-meta's hosted endpoint
 * (npm.antfu.dev), NOT the configured npm registry, with a hard 5s timeout
 * per packument — and it exits 0 even when every fetch fails. On a machine
 * whose egress policy blocks that host, taze prints one
 * `Timeout requesting "<pkg>"` (or `Failed to fetch package "<pkg>"`) per
 * dependency and then reports "Already up to date": a false green that
 * silently skips the update check for every timed-out package. update.mts
 * uses this parser to fail LOUD instead.
 */

// taze prints one of two failure prefixes followed by a double-quoted package
// name when it can't reach npm.antfu.dev; the capture group extracts that name.
const PACKUMENT_FAILURE_PATTERN =
  /(?:Timeout requesting|Failed to fetch package) "([^"\n]+)"/g

// Distinct package specs taze failed to look up, sorted.
export function collectPackumentFailures(output: string): string[] {
  const failed = new Set<string>()
  for (const match of output.matchAll(PACKUMENT_FAILURE_PATTERN)) {
    failed.add(match[1]!)
  }
  return [...failed].toSorted()
}
