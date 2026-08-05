/**
 * @file The repo-tunable vitest settings surface — the `vitest` section of
 *   the canonical per-repo settings file
 *   (.config/repo/socket-wheelhouse.json), split from vitest.config.mts along
 *   its natural seam: everything here READS settings, everything there
 *   RESOLVES runtime config from them. One file, one parse; each key's
 *   contract is on its field below, and docs/agents.md/fleet/test-layout.md
 *   carries the tier rationale.
 *   Exported readers are ordered alphabetically, which `socket/sort-source-
 *   methods` enforces in every consuming member. Neither copy of this file is
 *   linted in the wheelhouse itself, so the order is a downstream contract.
 */

import { existsSync, readFileSync } from 'node:fs'

export interface VitestRepoConfig {
  // Module resolve aliases for the test transform, e.g.
  // `{ "@socketsecurity/sdk": "./dist/index.browser.js" }`. A key is a LITERAL
  // specifier, never a glob, so a monorepo lists one entry per package; see
  // mergeVitestAlias for the dot-relative semantics.
  alias?: Record<string, string> | undefined
  // Extra `resolve.conditions`. The route for a monorepo whose `exports` map
  // carries a `source` condition: without it vitest resolves a workspace
  // package to its built `dist`, the instrumented `src` never runs, and the
  // repo reports 0% coverage.
  conditions?: string[] | undefined
  conformanceExclude?: string[] | undefined
  lanes?: VitestLanes | undefined
  // Worker cap for the pool, floored against the CI/coverage-aware fallback.
  maxWorkers?: number | undefined
  // Globs safe to run in the faster non-isolated pool.
  nonIsolated?: string[] | undefined
  // node:test homes excluded from vitest discovery, e.g. `tools/**/test/**` for
  // a `node --test` tool corpus. prefer-vitest-guard reads the SAME key so its
  // allowlist and this exclude never drift.
  nodeTestExclude?: string[] | undefined
  pool?: 'forks' | 'threads' | undefined
}

/**
 * Test LANES — a SPEED category, orthogonal to test TYPE (unit/integration/e2e)
 * — from the `vitest.lanes` section of the canonical per-repo settings file
 * (.config/repo/socket-wheelhouse.json; see paths.mts's resolver order for the
 * fallbacks). `slow` = heavy suites (subprocess-per-case, e.g. hook integration
 * specs); `mid` = isolated in-process suites (env-mutating / vi.mock /
 * fs-heavy); `fast` = the implicit complement, pure in-process. The runner's
 * `--lane <fast|mid|slow>` flag (scripts/fleet/test.mts) selects one, and bare
 * `pnpm test` defaults to `fast` for a quick local loop. The lane filter is
 * INERT under coverage and for an unset FLEET_LANE (an --all / scoped / cover
 * run), so coverage + CI run EVERY lane — the split shapes only the fast local
 * feedback loop and never removes a suite from the gate.
 */
export interface VitestLanes {
  mid?: string[] | undefined
  slow?: string[] | undefined
}

// The settings file, canonical location first and the repo-root dotfile as the
// one fallback a member may ship.
export const SETTINGS_FILES = [
  '.config/repo/socket-wheelhouse.json',
  '.socket-wheelhouse.json',
] as const

/**
 * The CONFORMANCE tier — heavy external-suite wrappers (a full Test262 corpus
 * per implementation, upstream conformance harnesses) named by
 * `vitest.conformanceExclude` in the settings file.
 *
 * `scripts/repo/test-conformance.mts` runs this tier explicitly with
 * FLEET_TEST_CONFORMANCE=1; every other run must EXCLUDE it. Both halves live
 * here because both were previously unwired: the runner set the env var and
 * nothing read it, and the setting named the tier while no lane excluded it —
 * so `pnpm run cover` spawned a ~92k-scenario corpus per BUILT implementation,
 * three at once. Against the 60s unit budget that reads as a hung run rather
 * than the multi-hour sweep it actually is.
 */
export function readConformanceExcludeGlobs(): string[] {
  return stringArray(readVitestSettings().conformanceExclude)
}

export function readNonIsolatedGlobs(): string[] {
  return stringArray(readVitestSettings().nonIsolated)
}

export function readVitestLanes(): VitestLanes {
  const lanes = readVitestSettings().lanes
  return lanes && typeof lanes === 'object' && !Array.isArray(lanes)
    ? { mid: stringArray(lanes.mid), slow: stringArray(lanes.slow) }
    : {}
}

/**
 * The `vitest` section of the settings file. The ONE settings-file parse in
 * this config: every resolver reads its key off this, so a torn or absent
 * file degrades to fleet defaults in exactly one place instead of six.
 */
export function readVitestSettings(): VitestRepoConfig {
  for (let i = 0, { length } = SETTINGS_FILES; i < length; i += 1) {
    const file = SETTINGS_FILES[i]!
    if (!existsSync(file)) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const section =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { vitest?: VitestRepoConfig | undefined }).vitest
          : undefined
      return section && typeof section === 'object' && !Array.isArray(section)
        ? section
        : {}
    } catch {
      return {}
    }
  }
  return {}
}

export function repoNodeTestExcludeGlobs(): string[] {
  return stringArray(readVitestSettings().nodeTestExclude)
}

/**
 * A settings value read as a string array; anything else reads as empty.
 */
export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((g): g is string => typeof g === 'string')
    : []
}
