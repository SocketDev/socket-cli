/**
 * @file The repo-tunable vitest settings surface — the `vitest` section of
 *   the canonical per-repo settings file
 *   (.config/repo/socket-wheelhouse.json), split from vitest.config.mts along
 *   its natural boundary: everything here READS settings, everything there
 *   RESOLVES runtime config from them. One file, one parse; each key's
 *   contract is on its field below, and docs/fleet/agents.md/test-layout.md
 *   carries the tier rationale.
 *   Exported readers are ordered alphabetically, which `socket/sort-source-
 *   methods` enforces in every consuming member. Neither copy of this file is
 *   linted in the wheelhouse itself, so the order is a downstream contract.
 */

import { existsSync, globSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

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
 * fs-heavy); `fast` = pure in-process. When `fast` is declared, `mid` becomes
 * the complement of `fast` and `slow`, so unclassified tests remain covered.
 * Without it, `fast` remains the complement of `mid` and `slow`. The runner's
 * `--lane <fast|mid|slow>` flag (scripts/fleet/test.mts) selects one, and bare
 * `pnpm test` defaults to `fast` for a quick local loop. The lane filter is
 * active under coverage too. An unset FLEET_LANE traverses every lane; the
 * coverage runner selects each lane in turn and merges their reports.
 */
export interface VitestLanes {
  fast?: string[] | undefined
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
 * Resolve the shared project while retaining Node's glob semantics. Most lane
 * exclusions are exact test files: checking those in a Set avoids repeatedly
 * matching hundreds of literal patterns during glob traversal. Only ordinary
 * relative file paths qualify; escapes, glob syntax, unusual names, missing
 * paths and directories stay with Node's original exclusion implementation.
 */
export function discoverSharedTestFiles(
  patterns: string[],
  options: { include: string[]; exclude: string[]; cwd?: string | undefined },
): string[] {
  const exactFiles = new Set<string>()
  const globExcludes: string[] = []
  for (const pattern of options.exclude) {
    // Positive literal grammar: no escape, extglob, brace or bracket syntax;
    // segments cannot be dot/dotdot. Unrecognized forms use native glob.
    const literal =
      /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.test\.(?:js|ts|mjs|mts|cjs)$/u.test(
        pattern,
      )
    let regularFile = false
    if (literal) {
      try {
        regularFile = lstatSync(
          path.resolve(options.cwd ?? '.', pattern),
        ).isFile()
      } catch {
        // Missing or unreadable candidates retain native exclusion behavior.
      }
    }
    if (regularFile) {
      exactFiles.add(pattern)
    } else {
      globExcludes.push(pattern)
    }
  }
  return [
    ...globSync(patterns, { cwd: options.cwd, exclude: globExcludes }),
  ].filter(
    file =>
      !exactFiles.has(file.split(path.sep).join('/')) &&
      options.include.some(pattern => path.matchesGlob(file, pattern)),
  )
}

/**
 * The CONFORMANCE tier — heavy external-suite wrappers (a full Test262 corpus
 * per implementation, upstream conformance harnesses) named by
 * `vitest.conformanceExclude` in the settings file.
 *
 * `scripts/repo/test-conformance.mts` runs this tier explicitly with
 * FLEET_TEST_CONFORMANCE=1; every other run must EXCLUDE it. Both halves live
 * here so neither can sit unwired: an env var the runner sets and nothing
 * reads, or a setting that names the tier while no lane excludes it, would —
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
  return lanes !== null && typeof lanes === 'object' && !Array.isArray(lanes)
    ? {
        ...(Array.isArray(lanes.fast) ? { fast: stringArray(lanes.fast) } : {}),
        mid: stringArray(lanes.mid),
        slow: stringArray(lanes.slow),
      }
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
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { vitest?: VitestRepoConfig | undefined }).vitest
          : undefined
      return section !== null &&
        typeof section === 'object' &&
        !Array.isArray(section)
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
