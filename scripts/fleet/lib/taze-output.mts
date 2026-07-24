/**
 * Parse taze output for version-lookup failures.
 *
 * Taze exits 0 even when every version lookup fails. On a machine whose
 * egress can't reach the registry (or where the single-registry patch didn't
 * apply and lookups leave for fast-npm-meta's hosted endpoint, which fleet
 * egress policy blocks), taze prints one `Failed to fetch package "<pkg>"`
 * (or `Timeout requesting "<pkg>"`) per dependency and then reports "Already
 * up to date": a false green that silently skips the update check for every
 * timed-out package. update.mts uses this parser to fail LOUD instead.
 */

// taze prints one of two failure prefixes followed by a double-quoted package
// name when a version lookup fails; the capture group extracts that name.
const PACKUMENT_FAILURE_PATTERN =
  /(?:Failed to fetch package|Timeout requesting) "([^"\n]+)"/g

// Distinct package specs taze failed to look up, sorted.
export function collectPackumentFailures(output: string): string[] {
  const failed = new Set<string>()
  for (const match of output.matchAll(PACKUMENT_FAILURE_PATTERN)) {
    failed.add(match[1]!)
  }
  return [...failed].toSorted()
}
