/**
 * @file Fleet-canonical platform predicates and platform-aware name helpers for
 *   tests. Re-exports the single-source-of-truth `WIN32` + `normalizePath` from
 *   `@socketsecurity/lib-stable` so tests have one import surface and any
 *   future change to the canonical detection flows through one place. Pairs
 *   with `./timing.mts` (Windows-tolerant timing budgets), `./tags.mts`
 *   (test-title prefixes), and `./env.mts` (env-flag helpers). Adoption is
 *   opt-in by directory presence — the `socket/prefer-windows-test-helpers`
 *   lint rule fires only when `test/fleet/_shared/lib/` is present.
 */
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { envFlag } from './env.mts'

/**
 * Re-exports of the fleet-canonical Windows predicate + path normalizer.
 * Re-exported (not re-derived from `process.platform` / `path.sep`) so any
 * future change to canonical detection / normalization — VFS-aware probes,
 * env-overridden test fixtures, additional separators to fold — flows through
 * one source of truth.
 */
export { WIN32, normalizePath }

/**
 * True when running under continuous integration. Reads the `CI` env var via
 * {@link envFlag} so `CI=1` and `CI=true` (the two shapes GitHub Actions /
 * generic CI runners set) both evaluate truthy, while unset / `CI=0` /
 * `CI=false` evaluate false. Use this anywhere a test needs to widen a budget
 * or skip a live integration on CI runners.
 */
export const IS_CI: boolean = envFlag('CI')

/**
 * Native path separator for the current platform: `\\` on Windows, `/`
 * elsewhere. Use only when a test asserts on a path string that hasn't been
 * normalized through {@link normalizePath} / `toUnixPath`. Prefer normalizing
 * the value under test instead — this helper covers the rare case where the
 * un-normalized form is the actual contract.
 */
export const NATIVE_PATH_SEP: string = WIN32 ? '\\' : '/'

/**
 * Append `.exe` to `name` on Windows; return `name` unchanged elsewhere. For
 * tests that resolve a binary by basename and need to match the on-disk
 * filename across platforms.
 *
 * @example
 *   ;```ts
 *   const javaBin = windowsExe('java')  // 'java.exe' on Windows, 'java' elsewhere
 *   ```
 */
export function windowsExe(name: string): string {
  return WIN32 ? `${name}.exe` : name
}
