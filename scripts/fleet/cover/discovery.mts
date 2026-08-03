/**
 * @file Repo-first config + build-entry discovery for the coverage runner
 *   (scripts/fleet/cover.mts). Pure resolution helpers — no spawning, no
 *   reporting — so they unit-test without running a real coverage pass. The
 *   runner owns orchestration; this owns "what config / suites / build entry
 *   does THIS repo have." Byte-identical across every fleet repo.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findSocketWheelhouseConfig } from '../paths.mts'

const logger = getDefaultLogger()

// The repo-root-relative build entry candidates, in precedence order. Most
// repos ship scripts/build.mts; some name it scripts/bundle.mts after the
// build→bundle rename.
export const BUILD_ENTRY_CANDIDATES: readonly string[] = [
  'scripts/build.mts',
  'scripts/bundle.mts',
  // Repo-owned build pipelines that moved under scripts/repo/ (a member that
  // separated its bespoke build from the cascaded scripts/fleet/ after the
  // scripts/repo migration — e.g. socket-sdk-js's scripts/repo/build.mts,
  // socket-lib's scripts/repo/bundle.mts). Without these, a repo whose build
  // entry lives here resolves NONE, cover falls back to instrumenting sources
  // directly, and the merge reports 0.00% → a false threshold miss that fails
  // the release gate. Probed last (build before bundle, mirroring the
  // top-level order) so a top-level entry still wins.
  'scripts/repo/build.mts',
  'scripts/repo/bundle.mts',
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
  // Per-file coverage floors, keyed by repo-relative path. For a file the
  // aggregate gate cannot fairly cover — a module whose init branches on the
  // host OS has lines no single machine reaches — so that the repo-wide
  // minimum does not have to fall to that file's number. Applied by
  // `perFileThresholdFailures` in ./runner.mts.
  perFileThresholds?: Record<string, CoverThresholds> | undefined
  // Which test runner produces the coverage. A fixed enum (`vitest` | `bun`),
  // resolved by `resolveCoverRunner` in ./runner.mts; absent means `vitest`,
  // so an un-configured repo is unchanged. Declared here rather than as a
  // command string so nothing user-supplied reaches a command line.
  runner?: string | undefined
  suites?: Record<string, CoverSuiteConfig> | undefined
  thresholds?: CoverThresholds | undefined
}

export interface ResolvedSuite {
  name: string
  config: string | undefined
  runExclude: string[]
}

// Read the repo's cover config from the `cover` section of
// socket-wheelhouse.json. The file's LOCATION comes from the canonical resolver
// in scripts/fleet/paths.mts, which accepts all three sanctioned locations —
// hardcoding `.config/repo/socket-wheelhouse.json` here meant a member that
// keeps its marker at `.config/socket-wheelhouse.json` had its cover config
// silently never read (an empty config reads as "fleet defaults", so nothing
// ever said so). Returns an empty config when the file or section is absent so
// callers get fleet defaults. A malformed file is reported and treated as empty
// rather than crashing the run. `repoDir` defaults to the live repo root; tests
// pass a fixture dir.
export function readCoverConfig(repoDir: string): CoverConfig {
  const configPath = coverConfigPath(repoDir)
  if (configPath === undefined) {
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
    const cover = (parsed as { cover?: unknown | undefined }).cover
    if (!cover || typeof cover !== 'object') {
      return {}
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the parsed JSON is validated as an object above; CoverConfig pins the shape the runner consumes and every unknown key passes through untouched.
    return cover as CoverConfig
  } catch (e) {
    logger.warn(
      `Failed to parse ${path.relative(repoDir, configPath)}: ${errorMessage(e)} — ignoring`,
    )
    return {}
  }
}

/**
 * The socket-wheelhouse.json path the cover config is read from, or undefined
 * when the repo has none. Exported so an error message can name the file the
 * operator must edit.
 */
export function coverConfigPath(repoDir: string): string | undefined {
  return findSocketWheelhouseConfig(repoDir)?.path
}

// Resolve the repo's source-map build entry, or undefined when none exists.
// Tooling repos, the wheelhouse itself, have no buildable artifact — coverage
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
