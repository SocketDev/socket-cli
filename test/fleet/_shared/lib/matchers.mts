/**
 * @file Fleet-canonical custom vitest matchers, registered globally from
 *   `test/fleet/scripts/setup.mts` via `expect.extend`. Currently:
 *   `toContainPath` — a separator-agnostic substring assertion for filesystem
 *   paths. Both the received and expected paths are run through the canonical
 *   `normalizePath` (folding `\` → `/`) before the `.includes()` check, so a
 *   test written once passes on darwin / linux / win32 without per-OS
 *   branching. Pairs with `./platform.mts` (the `normalizePath` source) — reach
 *   for this instead of hand-normalizing both sides at every call site.
 */

import { normalizePath } from './platform.mts'

export interface PathMatcherResult {
  pass: boolean
  message: () => string
}

// Implementation kept separate from registration so it unit-tests directly
// without spinning up vitest's expect.extend machinery.
export function toContainPathResult(
  received: unknown,
  expected: string,
): PathMatcherResult {
  if (typeof received !== 'string') {
    return {
      pass: false,
      message: () =>
        `expected a string path, received ${typeof received} (${String(received)})`,
    }
  }
  const normReceived = normalizePath(received)
  const normExpected = normalizePath(expected)
  const pass = normReceived.includes(normExpected)
  return {
    pass,
    message: () =>
      pass
        ? `expected "${normReceived}" not to contain path "${normExpected}"`
        : `expected "${normReceived}" to contain path "${normExpected}" (both compared with separators normalized to "/")`,
  }
}
