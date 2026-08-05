#!/usr/bin/env node
/*
 * @file Fail-closed gate for the multi-language coverage lanes. A repo declares
 *   its native traits ONCE in `.config/repo/socket-wheelhouse.json`
 *   `capabilities` (`cargo` / `go` / `cpp`) and the coverage runner dispatches
 *   one lane per trait from scripts/fleet/cover/lanes.mts. The failure class is
 *   a declared capability that measures NOTHING while `cover` reports success:
 *   no lane in the dispatch map, paths not on disk, a `cargo` trait with no
 *   Cargo.toml, or a lane that ran, measured 0 lines, and left the badge green.
 *
 *   PASS 1 — STATIC WIRING runs always, in every repo, off the checked-in
 *   tree alone (cheap, no toolchain, no artifact). Each capability must be a
 *   known one, resolve a lane, declare a path that exists, and carry its
 *   language's marker: a Cargo.toml for `cargo`, a go.mod for `go`, the
 *   repo-owned `scripts/repo/cover-cpp.mts` delegate for `cpp`. Pass-1
 *   findings are ALWAYS errors — static wiring has no soak excuse.
 *
 *   PASS 2 — MEASUREMENT EVIDENCE reads `<COVERAGE_DIR>/lane-summary.json`,
 *   the artifact the native lane runner persists, and asserts each declared
 *   capability's lane measured something: entry present, `measured: true`,
 *   `total > 0`. Release/CI tier only (FLEET_CHECK_RELEASE), since a fresh
 *   clone has no artifact and must not red-bar a dev loop, while the release
 *   tier runs `cover` first. A `measured: false` lane is an acceptable LOCAL
 *   skip (tool absent) and never acceptable in CI, where setup owns the
 *   toolchain. The artifact shape is
 *   `{ lanes: { <id>: { measured, summary: { total } } } }`; a flattened
 *   `total`, a capability-keyed entry, and an envelope-less root record all
 *   read the same way.
 *
 *   Exit codes: 0 = wired (and, on the release tier, measured); 1 = a pass-1
 *   wiring failure, or a pass-2 evidence failure once
 *   FLEET_COVERAGE_LANES_ENFORCE=1 flips the rollout seam on. COMMIT HYGIENE:
 *   check-registrations-resolve.mts fails any check file not wired into a
 *   runner, so this lands in the SAME commit as its check-steps registration.
 *   Usage: node scripts/fleet/check/coverage-lanes-are-wired.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { LANE_BY_CAPABILITY } from '../cover/lanes.mts'
import {
  COVERAGE_DIR,
  findSocketWheelhouseConfig,
  REPO_ROOT,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const CHECK_NAME = 'coverage-lanes-are-wired'
const CONFIG_FILE = '.config/repo/socket-wheelhouse.json'
const LANES_FILE = 'scripts/fleet/cover/lanes.mts'

/**
 * The capability keys a coverage lane can dispatch on. MIRROR of
 * `VALID_CAPABILITIES` in scripts/repo/sync-scaffolding/repo-shape.mts, copied
 * because scripts/fleet/ cascades into members carrying no scripts/repo tree.
 * drift-watch: keep the two lists identical.
 */
export const LANE_CAPABILITIES: readonly string[] = ['cargo', 'cpp', 'go']

/**
 * The repo-owned cpp coverage delegate the fleet cpp lane calls; its presence
 * IS the cpp marker, since C++ has no universal build manifest.
 */
export const CPP_LANE_DELEGATE = 'scripts/repo/cover-cpp.mts'

/**
 * The artifact the native lane runner persists after a `cover` pass.
 */
export const LANE_SUMMARY_PATH = path.join(COVERAGE_DIR, 'lane-summary.json')

export const MANIFEST_BY_CAPABILITY: ReadonlyMap<string, string> = new Map([
  ['cargo', 'Cargo.toml'],
  ['go', 'go.mod'],
])

/**
 * Glob magic that makes a declared path unprobeable as a literal path.
 */
const GLOB_MAGIC_RE = /[!*?[\]{}]/

export interface LaneWiringFinding {
  level: 'error' | 'warn'
  message: string
}

export interface DeclaredCapability {
  readonly capability: string
  readonly paths: readonly string[]
}

export interface LaneMeasurement {
  readonly measured: boolean | undefined
  readonly total: number | undefined
}

/**
 * Narrow to a non-null, non-array object.
 */
export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The raw `capabilities` value off a parsed socket-wheelhouse.json.
 */
export function readCapabilitiesBlock(repoConfig: unknown): unknown {
  return isPlainRecord(repoConfig) ? repoConfig['capabilities'] : undefined
}

/**
 * Every declared capability with its string paths (non-strings dropped).
 */
export function readDeclaredCapabilities(
  repoConfig: unknown,
): DeclaredCapability[] {
  const block = readCapabilitiesBlock(repoConfig)
  if (!isPlainRecord(block)) {
    return []
  }
  return Object.entries(block).map(({ 0: capability, 1: value }) => ({
    capability,
    paths: Array.isArray(value)
      ? value.filter((p): p is string => typeof p === 'string')
      : [],
  }))
}

/**
 * True when `declaredPath` carries glob magic (`packages/*` is legal).
 */
export function hasGlobMagic(declaredPath: string): boolean {
  return GLOB_MAGIC_RE.test(declaredPath)
}

/**
 * The deepest magic-free directory of a declared path, `.` for a bare glob.
 */
export function declaredPathPrefix(declaredPath: string): string {
  const kept: string[] = []
  const segments = normalizePath(declaredPath).split('/')
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    if (hasGlobMagic(segment)) {
      break
    }
    kept.push(segment)
  }
  return kept.join('/') || '.'
}

/**
 * The first `manifestName` under any declared path. A glob'd declaration names
 * its CHILDREN, so those are probed a level below the prefix too.
 */
export function findCapabilityManifest(
  repoRoot: string,
  paths: readonly string[],
  manifestName: string,
): string | undefined {
  for (const declaredPath of paths) {
    const base = path.join(repoRoot, declaredPathPrefix(declaredPath))
    if (existsSync(path.join(base, manifestName))) {
      return path.join(base, manifestName)
    }
    if (!hasGlobMagic(declaredPath)) {
      continue
    }
    let children: string[]
    try {
      children = readdirSync(base)
    } catch {
      continue
    }
    for (let i = 0, { length } = children; i < length; i += 1) {
      const child = children[i]!
      const candidate = path.join(base, child, manifestName)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * The lane id a capability dispatches to, `undefined` when the registry maps
 * none (a dispatch hole). Reads a record or Map registry and a lane's `id`.
 */
export function resolveLaneId(
  registry: unknown,
  capability: string,
): string | undefined {
  let entry: unknown
  if (registry instanceof Map) {
    entry = registry.get(capability)
  } else if (isPlainRecord(registry)) {
    entry = registry[capability]
  }
  if (entry === undefined || entry === null) {
    return undefined
  }
  if (typeof entry === 'string') {
    return entry
  }
  const id = isPlainRecord(entry) ? entry['id'] : undefined
  return typeof id === 'string' && id.length > 0 ? id : capability
}

/**
 * A lane's artifact entry, read through the `lanes` envelope or the root.
 */
export function readLaneEntry(
  artifact: unknown,
  keys: readonly string[],
): unknown {
  if (!isPlainRecord(artifact)) {
    return undefined
  }
  for (const container of [artifact['lanes'], artifact]) {
    if (!isPlainRecord(container)) {
      continue
    }
    for (const key of keys) {
      const value = container[key]
      if (isPlainRecord(value)) {
        return value
      }
    }
  }
  return undefined
}

/**
 * The `measured` flag + line `total` off a lane entry. The lane contract nests
 * the summary under `summary`; a flattened `total` reads the same way, and a
 * missing field reads as `undefined` — unmeasured.
 */
export function readLaneMeasurement(entry: unknown): LaneMeasurement {
  if (!isPlainRecord(entry)) {
    return { measured: undefined, total: undefined }
  }
  const measured = entry['measured']
  let total = entry['total']
  if (typeof total !== 'number') {
    const summary = entry['summary']
    total = isPlainRecord(summary) ? summary['total'] : undefined
  }
  return {
    measured: typeof measured === 'boolean' ? measured : undefined,
    total: typeof total === 'number' ? total : undefined,
  }
}

/**
 * The language-marker problems for one capability. Without its marker the
 * lane's tool has nothing to build or run.
 */
export function capabilityMarkerProblems(
  capability: string,
  paths: readonly string[],
  repoRoot: string,
  laneId: string,
): string[] {
  if (capability === 'cpp') {
    if (existsSync(path.join(repoRoot, CPP_LANE_DELEGATE))) {
      return []
    }
    return [
      `the cpp lane delegate is missing, so the ${laneId} lane has nothing ` +
        `to call. Where: ${CPP_LANE_DELEGATE} under ${repoRoot}. Saw absent, ` +
        `wanted the delegate. Fix: add it, or drop \`capabilities.cpp\`.`,
    ]
  }
  const manifest = MANIFEST_BY_CAPABILITY.get(capability)
  if (
    manifest === undefined ||
    findCapabilityManifest(repoRoot, paths, manifest) !== undefined
  ) {
    return []
  }
  return [
    `no ${manifest} under \`capabilities.${capability}\`. Where: ` +
      `${paths.join(', ')} under ${repoRoot}. Saw none, wanted one so the ` +
      `${laneId} lane has a project to measure. Fix: correct the paths, or ` +
      `drop the capability.`,
  ]
}

/**
 * PASS 1 — every declared capability's static wiring; empty means wired. Only
 * existence probes under `repoRoot`, so a unit test never spawns a lane.
 */
export function evaluateStaticWiring(
  repoConfig: unknown,
  repoRoot: string,
): LaneWiringFinding[] {
  const problems: string[] = []
  const block = readCapabilitiesBlock(repoConfig)
  if (block !== undefined && !isPlainRecord(block)) {
    problems.push(
      `the \`capabilities\` block is not an object, so no lane can be ` +
        `dispatched. Where: ${CONFIG_FILE}. Saw ${JSON.stringify(block)}, ` +
        `wanted a capability-to-paths map. Fix: write \`{ "cargo": ["."] }\`.`,
    )
  }
  const known = LANE_CAPABILITIES.join(', ')
  for (const { capability, paths } of readDeclaredCapabilities(repoConfig)) {
    if (!LANE_CAPABILITIES.includes(capability)) {
      problems.push(
        `\`capabilities.${capability}\` is not a coverage-lane capability. ` +
          `Where: ${CONFIG_FILE}. Saw "${capability}", wanted one of ` +
          `[${known}]. Fix: rename the key, or remove it.`,
      )
      continue
    }
    const laneId = resolveLaneId(LANE_BY_CAPABILITY, capability)
    if (laneId === undefined) {
      problems.push(
        `\`capabilities.${capability}\` dispatches to no lane, so its code ` +
          `is measured by nothing. Where: ${LANES_FILE} LANE_BY_CAPABILITY. ` +
          `Saw no "${capability}", wanted a lane. Fix: map it to its lane.`,
      )
      continue
    }
    if (paths.length === 0) {
      problems.push(
        `\`capabilities.${capability}\` declares no paths, so the ${laneId} ` +
          `lane has nothing to measure. Where: ${CONFIG_FILE}. Saw an empty ` +
          `array, wanted a path. Fix: list the paths (\`["."]\` is repo-wide).`,
      )
      continue
    }
    const missing = paths.filter(
      p => !existsSync(path.join(repoRoot, declaredPathPrefix(p))),
    )
    if (missing.length > 0) {
      problems.push(
        `\`capabilities.${capability}\` declares ${missing.length} path(s) ` +
          `not on disk, so the ${laneId} lane measures nothing forever. ` +
          `Where: ${CONFIG_FILE}, ${missing.join(', ')} under ${repoRoot}. ` +
          `Saw absent, wanted existing dirs. Fix: correct or drop them.`,
      )
      continue
    }
    problems.push(
      ...capabilityMarkerProblems(capability, paths, repoRoot, laneId),
    )
  }
  const level = 'error'
  return problems.map(message => ({ level, message }))
}

/**
 * PASS 2 — the measurement evidence for every declared capability; empty
 * means every lane measured lines. `config.enforce` picks the finding level, so
 * a caller can warn during the rollout soak window. The caller reads the
 * artifact.
 */
export function evaluateMeasurementEvidence(
  repoConfig: unknown,
  artifact: unknown,
  config: { enforce: boolean },
): LaneWiringFinding[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const level = cfg.enforce ? 'error' : 'warn'
  const declared = readDeclaredCapabilities(repoConfig).filter(
    ({ capability }) => LANE_CAPABILITIES.includes(capability),
  )
  if (declared.length === 0) {
    return []
  }
  const problems: string[] = []
  if (artifact === undefined || artifact === null) {
    problems.push(
      `the lane artifact is missing or unreadable, so nothing shows the ` +
        `${declared.length} declared lane(s) measured anything. Where: ` +
        `${LANE_SUMMARY_PATH}. Saw nothing readable, wanted one summary per ` +
        `capability. Fix: run pnpm run cover before the release check.`,
    )
    return problems.map(message => ({ level, message }))
  }
  for (const { capability } of declared) {
    const laneId = resolveLaneId(LANE_BY_CAPABILITY, capability) ?? capability
    const entry = readLaneEntry(artifact, [laneId, capability])
    if (entry === undefined) {
      problems.push(
        `the ${laneId} lane has no artifact entry, so ` +
          `\`capabilities.${capability}\` went unmeasured while cover ` +
          `reported success. Where: ${LANE_SUMMARY_PATH}. Saw no entry for ` +
          `"${laneId}", wanted one. Fix: run pnpm run cover.`,
      )
      continue
    }
    const { measured, total } = readLaneMeasurement(entry)
    if (measured !== true) {
      problems.push(
        `the ${laneId} lane reports measured=${measured ?? '(missing)'}, a ` +
          `tool-absent skip. Fine on a dev machine, never in CI, where setup ` +
          `owns the toolchain. Where: ${LANE_SUMMARY_PATH}, lane ` +
          `"${laneId}". Saw a skip, wanted measured=true. Fix: install the ` +
          `${capability} coverage toolchain in CI setup.`,
      )
      continue
    }
    if (total === undefined || total <= 0) {
      problems.push(
        `the ${laneId} lane ran and measured 0 lines while ` +
          `\`capabilities.${capability}\` declares paths, a false green. ` +
          `Where: ${LANE_SUMMARY_PATH}, lane "${laneId}". Saw ` +
          `total=${total ?? '(missing)'}, wanted above 0. Fix: confirm those ` +
          `paths hold the lane's tests, then re-run cover.`,
      )
    }
  }
  return problems.map(message => ({ level, message }))
}

/**
 * Parse a JSON file; `undefined` when absent, unreadable, or corrupt.
 */
export function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * One indented line per finding, for a logger block.
 */
export function joinMessages(findings: readonly LaneWiringFinding[]): string {
  return findings.map(f => f.message).join('\n  ')
}

/**
 * The success line for a clean run, naming which tier ran.
 */
export function summaryLine(
  declaredCount: number,
  tier: 'interactive' | 'release',
): string {
  if (declaredCount === 0) {
    return `[${CHECK_NAME}] no native coverage capabilities declared.`
  }
  return tier === 'release'
    ? `[${CHECK_NAME}] ${declaredCount} declared capability lane(s) are ` +
        `wired and measured lines.`
    : `[${CHECK_NAME}] static lane wiring is current for ${declaredCount} ` +
        `capability(ies); measurement evidence is release/CI tier only (run ` +
        `pnpm run cover, then pnpm run check --release).`
}

// One logger call per line so each finding gets its own prefix.
function report(
  emit: (message: string) => void,
  headline: string,
  findings: readonly LaneWiringFinding[],
): void {
  emit(`[${CHECK_NAME}] ${headline}:`)
  for (let i = 0, { length } = findings; i < length; i += 1) {
    emit(`  ${findings[i]!.message}`)
  }
}

function fail(headline: string, findings: readonly LaneWiringFinding[]): void {
  report(m => logger.fail(m), headline, findings)
  process.exitCode = 1
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const location = findSocketWheelhouseConfig(REPO_ROOT)
  const repoConfig = location ? readJsonFile(location.path) : undefined
  const declaredCount = readDeclaredCapabilities(repoConfig).length
  const wiring = evaluateStaticWiring(repoConfig, REPO_ROOT)
  if (wiring.length > 0) {
    fail('declared coverage capabilities are not wired to a lane', wiring)
    return
  }
  // Pass 2 is release/CI tier only — a fresh clone has no lane artifact, so
  // demanding one would red-bar every dev's inner loop. check.mts sets
  // FLEET_CHECK_RELEASE under --release / CI, where cover runs first.
  const tier: 'interactive' | 'release' = process.env['FLEET_CHECK_RELEASE']
    ? 'release'
    : 'interactive'
  // Disabled seam (rollout step 1): pass-2 enforcement. A declared capability
  // whose lane skipped or measured 0 lines is a false green, but failing hard
  // before every capability repo has run its lane green would red-bar member
  // CI fleet-wide. Loud warnings by default; turn on with
  // FLEET_COVERAGE_LANES_ENFORCE=1. Hardening step: flip this default to
  // enforced after one soak window, once ultrathink, node-smol, and stuie each
  // report a measured lane. Pass-1 wiring above always fails hard.
  const enforce = process.env['FLEET_COVERAGE_LANES_ENFORCE'] === '1'
  const evidence =
    tier === 'release'
      ? evaluateMeasurementEvidence(
          repoConfig,
          readJsonFile(LANE_SUMMARY_PATH),
          { enforce },
        )
      : []
  if (evidence.length === 0) {
    if (!quiet) {
      logger.success(summaryLine(declaredCount, tier))
    }
    return
  }
  if (enforce) {
    fail('declared coverage capabilities measured nothing', evidence)
    return
  }
  report(
    m => logger.warn(m),
    'declared coverage capabilities measured nothing; a warning until FLEET_COVERAGE_LANES_ENFORCE=1',
    evidence,
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every declared language capability is wired to a coverage lane',
  help: `Usage: node scripts/fleet/check/coverage-lanes-are-wired.mts [flags]

  --quiet  suppress the pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
