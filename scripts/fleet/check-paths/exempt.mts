/**
 * @file Exempt-file patterns for the path-hygiene gate. Lists the files that
 *   legitimately enumerate path segments — the canonical constructors
 *   (`paths.mts`), build-infra helpers, and the scanners / hooks that READ the
 *   segment vocabulary in order to flag everyone else. Pure data + predicate;
 *   no I/O. Paths are normalized to forward-slash form before matching so the
 *   regexes work on Windows too — see [`docs/claude.md/fleet/code-style.md`]
 *   (cross-platform path matching).
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// File-path patterns that legitimately enumerate path segments.
// Match against `normalizePath(filePath)` only — never raw paths.
export const EXEMPT_FILE_PATTERNS: RegExp[] = [
  // Any paths.mts is the canonical constructor.
  /(?:^|\/)paths\.(?:cts|js|mts)$/,
  // Build-infra owns shared helpers that enumerate stages.
  /packages\/build-infra\/lib\/paths\.mts$/,
  /packages\/build-infra\/lib\/constants\.mts$/,
  // Path-scanning gates that intentionally enumerate.
  /scripts\/check-paths\.mts$/,
  /scripts\/check-paths\//,
  /scripts\/check-consistency\.mts$/,
  /\.claude\/hooks\/fleet\/path-guard\//,
]

export function isExempt(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return EXEMPT_FILE_PATTERNS.some(re => re.test(normalized))
}
