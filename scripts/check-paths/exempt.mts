/**
 * @fileoverview Exempt-file patterns for the path-hygiene gate.
 *
 * Lists the files that legitimately enumerate path segments — the
 * canonical constructors (`paths.mts`), build-infra helpers, and the
 * scanners / hooks that READ the segment vocabulary in order to flag
 * everyone else. Pure data + predicate; no I/O.
 */

// File-path patterns that legitimately enumerate path segments.
export const EXEMPT_FILE_PATTERNS: RegExp[] = [
  // Any paths.mts is the canonical constructor.
  /(^|\/)paths\.(mts|cts|js)$/,
  // Build-infra owns shared helpers that enumerate stages.
  /packages\/build-infra\/lib\/paths\.mts$/,
  /packages\/build-infra\/lib\/constants\.mts$/,
  // Path-scanning gates that intentionally enumerate.
  /scripts\/check-paths\.mts$/,
  /scripts\/check-paths\//,
  /scripts\/check-consistency\.mts$/,
  /\.claude\/hooks\/path-guard\//,
  // Allowlist + config files.
  /\.github\/paths-allowlist\.yml$/,
]

export const isExempt = (filePath: string): boolean =>
  EXEMPT_FILE_PATTERNS.some(re => re.test(filePath))
