/**
 * @file The golden-fixture target resolver, shared by the
 *   `golden-fixture-naming-guard` hook and the belt-scan check
 *   `scripts/fleet/check/golden-fixtures-are-named-golden.mts` (1 predicate, 1
 *   reference). Lives under `_shared/` (ships to members, survives the
 *   bundle-only cutover) because the check runs in members.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Basename ends with `.expected.json` (case-insensitive extension).
const EXPECTED_JSON_RE = /\.expected\.json$/i

/**
 * If `filePath` is a `*.expected.json` fixture, return the `*.golden.json` name
 * it should use; otherwise undefined. Pure. Path is normalized first so the
 * suffix test is separator-agnostic.
 */
export function goldenTarget(filePath: string): string | undefined {
  const unix = normalizePath(filePath)
  if (!EXPECTED_JSON_RE.test(unix)) {
    return undefined
  }
  return unix.replace(EXPECTED_JSON_RE, '.golden.json')
}
