/**
 * @file Repo-first config + build-entry discovery for the coverage runner
 *   (scripts/fleet/cover.mts). Pure resolution helpers — no spawning, no
 *   reporting — so they unit-test without running a real coverage pass. The
 *   runner owns orchestration; this owns "what config / suites / build entry
 *   does THIS repo have." Byte-identical across every fleet repo.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// The repo-root-relative build entry candidates, in precedence order. Most
// repos ship scripts/build.mts; some name it scripts/bundle.mts after the
// build→bundle rename.
export const BUILD_ENTRY_CANDIDATES: readonly string[] = [
  'scripts/build.mts',
  'scripts/bundle.mts',
]

// Standard fleet test-suite vocabulary. `shared` is the default shared-context
// suite (pool: threads); `isolated` is the full-isolation suite (forks) for
// tests that mock globals / chdir / mutate process.env. Each maps to a vitest
// config basename resolved repo-first.
export const SUITE_DEFAULTS: ReadonlyArray<{
  name: string
  configBasename: string
}> = [
  { name: 'shared', configBasename: 'vitest.config.mts' },
  { name: 'isolated', configBasename: 'vitest.config.isolated.mts' },
]

export interface CoverSuiteConfig {
  // Explicit config path override (repo-root-relative). Defaults to the
  // repo-first resolution of the suite's standard basename.
  config?: string | undefined
  // Globs passed as `vitest --exclude <glob>` for THIS suite's run — skips
  // running matching test files (e.g. a test that exercises another package
  // and would pollute this repo's coverage denominator).
  runExclude?: string[] | undefined
}

export interface CoverThresholds {
  statements?: number | undefined
  branches?: number | undefined
  functions?: number | undefined
  lines?: number | undefined
}

export interface CoverConfig {
  suites?: Record<string, CoverSuiteConfig> | undefined
  thresholds?: CoverThresholds | undefined
}

export interface ResolvedSuite {
  name: string
  config: string | undefined
  runExclude: string[]
}

// Read the repo-owned cover config (`.config/repo/cover.json`, legacy
// `.config/cover.json` fallback). Returns an empty config when absent so
// callers get fleet defaults. A malformed file is reported and treated as
// empty rather than crashing the run. `repoDir` defaults to the live repo
// root; tests pass a fixture dir.
export function readCoverConfig(repoDir: string): CoverConfig {
  const configPath = [
    path.join(repoDir, '.config', 'repo', 'cover.json'),
    path.join(repoDir, '.config', 'cover.json'),
  ].find(p => existsSync(p))
  if (!configPath) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') {
      logger.warn(
        `${path.relative(repoDir, configPath)} must be a JSON object — ignoring`,
      )
      return {}
    }
    return parsed as CoverConfig
  } catch (e) {
    logger.warn(
      `Failed to parse ${path.relative(repoDir, configPath)}: ${errorMessage(e)} — ignoring`,
    )
    return {}
  }
}

// Resolve the repo's source-map build entry, or undefined when none exists.
// Tooling repos (the wheelhouse itself) have no buildable artifact — coverage
// then instruments the sources directly instead of building first.
export function resolveBuildEntry(repoDir: string): string | undefined {
  for (let i = 0, { length } = BUILD_ENTRY_CANDIDATES; i < length; i += 1) {
    const rel = BUILD_ENTRY_CANDIDATES[i]!
    if (existsSync(path.join(repoDir, rel))) {
      return rel
    }
  }
  return undefined
}

// Resolve a config basename repo-first: prefer `.config/repo/<name>`, fall back
// to the legacy top-level `.config/<name>`. Returns the repo-root-relative path
// vitest should load, or undefined when neither location has the file.
export function resolveConfig(
  repoDir: string,
  basename: string,
): string | undefined {
  const candidates = [
    path.join('.config', 'repo', basename),
    path.join('.config', basename),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const rel = candidates[i]!
    if (existsSync(path.join(repoDir, rel))) {
      return rel
    }
  }
  return undefined
}

// Merge the fleet suite defaults with the repo's cover.json into the concrete
// list of suites to run. A suite runs when its config resolves (repo-first or
// explicit override). Per-suite runExclude comes from cover.json.
export function resolveSuites(
  repoDir: string,
  coverConfig: CoverConfig,
): ResolvedSuite[] {
  const suiteConfigs = coverConfig.suites ?? {}
  const resolved: ResolvedSuite[] = []
  for (let i = 0, { length } = SUITE_DEFAULTS; i < length; i += 1) {
    const def = SUITE_DEFAULTS[i]!
    const override = suiteConfigs[def.name] ?? {}
    const config = override.config ?? resolveConfig(repoDir, def.configBasename)
    if (!config) {
      continue
    }
    resolved.push({
      name: def.name,
      config,
      runExclude: override.runExclude ?? [],
    })
  }
  return resolved
}
