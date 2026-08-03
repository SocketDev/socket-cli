/**
 * @file The native coverage lane REGISTRY — the single source of truth for
 *   capability → lane dispatch. A repo's socket-wheelhouse.json declares which
 *   native traits it has (`capabilities.cargo`, `.go`, `.cpp`); this module
 *   turns that declaration into the concrete list of lanes to run, and nothing
 *   else in the pipeline decides which lanes exist.
 *   Layering: ./lane-contract.mts holds the types and the shared helpers, the
 *   three lane modules import THAT, and this registry imports the lanes. One
 *   direction, so a lane can never reach back into the registry and a fourth
 *   lane costs one entry in `LANE_BY_CAPABILITY` plus one row in the
 *   capability list.
 *   Nothing here spawns anything. Resolution is pure and unit-tested, so a
 *   mis-wired repo is caught by a test rather than by a coverage run that
 *   quietly measures fewer languages than the repo ships.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findSocketWheelhouseConfig } from '../paths.mts'
import { cppLane } from './cpp-lane.mts'
import { goLane } from './go-lane.mts'
import { LANE_CAPABILITIES, readRepoCapabilities } from './lane-contract.mts'
import { rustLane } from './rust-lane.mts'
import type { CoverageLane, LaneCapability } from './lane-contract.mts'

const logger = getDefaultLogger()

/**
 * Capability → lane. The ONE dispatch table: every consumer looks a lane up
 * here rather than importing a lane module directly, so a repo that declares a
 * capability cannot end up with no lane behind it.
 */
export const LANE_BY_CAPABILITY: Readonly<
  Record<LaneCapability, CoverageLane>
> = {
  cargo: rustLane,
  cpp: cppLane,
  go: goLane,
}

export interface ActiveLane {
  lane: CoverageLane
  paths: string[]
}

/**
 * The lanes THIS repo's config activates, in the fixed cargo → go → cpp order
 * of `LANE_CAPABILITIES`. `repoConfig` is a parsed socket-wheelhouse.json root;
 * anything malformed resolves to no lanes, because the config validator in
 * sync-scaffolding already fails loud on a bad `capabilities` block at write
 * time.
 */
export function resolveActiveLanes(repoConfig: unknown): ActiveLane[] {
  const capabilities = readRepoCapabilities(repoConfig)
  const active: ActiveLane[] = []
  for (let i = 0, { length } = LANE_CAPABILITIES; i < length; i += 1) {
    const capability = LANE_CAPABILITIES[i]!
    const paths = capabilities[capability]
    // A capability declared with an EMPTY array has nowhere to look, so there is
    // nothing to measure and no lane to run — declared-nothing is not a lane
    // that silently measured zero. That shape is still a config smell, and the
    // coverage-lanes-are-wired check is what flags it; skipping it here keeps
    // the run honest without turning a config defect into a coverage failure.
    if (!paths || paths.length === 0) {
      continue
    }
    active.push({ lane: LANE_BY_CAPABILITY[capability], paths })
  }
  return active
}

/**
 * The parsed socket-wheelhouse.json root for `repoDir`, or `undefined` when the
 * repo has none or the file is malformed.
 *
 * The file's LOCATION comes from the canonical resolver in
 * scripts/fleet/paths.mts. Hardcoding `.config/repo/socket-wheelhouse.json`
 * here would repeat the bug `readCoverConfig` in ./discovery.mts documents: a
 * member whose marker sits elsewhere had its config silently never read, and an
 * empty config reads as "fleet defaults", so nothing ever said so. For the
 * lanes that failure mode is worse — an unread config declares no capabilities,
 * so every native lane would vanish without a word.
 */
export function readSocketWheelhouseConfigObject(repoDir: string): unknown {
  const location = findSocketWheelhouseConfig(repoDir)
  if (!location) {
    return undefined
  }
  const where = path.relative(repoDir, location.path)
  try {
    const parsed = JSON.parse(readFileSync(location.path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn(`${where} must be a JSON object — ignoring`)
      return undefined
    }
    return parsed
  } catch (e) {
    logger.warn(`Failed to parse ${where}: ${errorMessage(e)} — ignoring`)
    return undefined
  }
}
