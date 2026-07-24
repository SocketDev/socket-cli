/**
 * @file Fleet-canonical vitest setup, wired via `setupFiles` in
 *   `.config/repo/vitest.config.mts` (loaded only when present). Registers the
 *   fleet's custom matchers globally with `expect.extend` so every test under
 *   `test/**` can use them without an import. Currently: `toContainPath` — a
 *   separator-agnostic path-substring assertion (see ./../_shared/lib/
 *   matchers.mts). Also isolates git so a test's git ops can't touch the live
 *   repo, and FAILS NETWORK CLOSED (nock.disableNetConnect; loopback allowed)
 *   so any test hitting an unmocked third-party server throws — the fleet
 *   "tests never connect to third-party servers" rule, enforced fleet-wide here
 *   so it isn't per-repo. This is transport-complete: nock (>=14) intercepts
 *   `fetch`/undici as well as `http`/`https`, so `disableNetConnect()` blocks
 *   every client — no separate `fetch` wrapper is needed. Repo-specific setup
 *   belongs in `test/repo/scripts/setup.mts`.
 */

import nock from 'nock'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'

import { isolateGitEnv } from '../../../.git-hooks/_shared/isolate-git-env.mts'
import { prepareSubprocessCoverageEnv } from '../_shared/lib/coverage-env.mts'
import { toContainPathResult } from '../_shared/lib/matchers.mts'

// Neutralize the inherited git env so a test's `git` spawns can't touch the
// live repo. The stronger `pinConfigToNull` form is safe here — no vitest
// fixture manipulates a controlled global git config (the signing-gate tests
// that do live under node:test, which strips-only). Single source of truth in
// .git-hooks/_shared/isolate-git-env.mts.
isolateGitEnv({ pinConfigToNull: true })

// Subprocess coverage capture (cover.mts sets FLEET_CHILD_V8_COVERAGE_DIR).
// This also drops the already-consumed COVERAGE flag so a test-spawned Vitest
// child cannot clean the outer run's shared coverage/.tmp reports.
prepareSubprocessCoverageEnv(process.env)

// Fail network CLOSED fleet-wide: block every real connection so an unmocked
// third-party request throws instead of reaching the internet. Loopback stays
// reachable for local fixture servers. Tests mock remote endpoints with nock;
// everything else fails closed. (Was repo-only — promoted here so every fleet
// repo inherits it.)
beforeAll(() => {
  nock.disableNetConnect()
  // Matches loopback hostnames optionally followed by a port.
  // `^` start-of-string anchor
  // `(?:127\.0\.0\.1|localhost)` non-capturing group: IPv4 loopback or "localhost"
  // `(?::\d+)?` non-capturing group: optional colon + decimal port digits
  // `$` end-of-string anchor
  nock.enableNetConnect(/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/)
})

afterEach(() => {
  // Reset nock interceptors between tests so a registration cannot leak forward.
  nock.cleanAll()
})

afterAll(() => {
  nock.enableNetConnect()
})

expect.extend({
  toContainPath(received: unknown, expected: string) {
    return toContainPathResult(received, expected)
  },
})

declare module 'vitest' {
  // oxlint-disable-next-line typescript/no-explicit-any -- declaration merging requires the exact upstream type parameters (vitest's Matchers<T = any>).
  interface Matchers<T = any> {
    // Assert the received path string contains `expected` after both are
    // normalized to "/" separators — cross-platform path assertions without
    // per-OS branching.
    toContainPath: (expected: string) => T
  }
}
