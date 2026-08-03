/**
 * @file Shared `*.test.*` filename matcher for rules scoped to test files.
 *   Extracted from the 7 rules that each hand-rolled the identical regex
 *   (no-vitest-* family, no-src-import-in-test-expect). Matches `.test.mts` /
 *   `.test.ts` / `.test.cts` / `.test.mjs` / `.test.js`.
 */

export const TEST_FILE_RE = /\.test\.(?:[mc]?[jt]s)$/

// True when the path is a test file the test-scoped rules should run on.
export function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath)
}
