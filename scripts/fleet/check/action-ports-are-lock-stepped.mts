/*
 * @file Fleet policy (code-as-law): every `.github/actions/fleet/*` composite
 *   declares what it PORTS in the composite → upstream port map
 *   (`_shared/action-port-map.mts`), and every declared port stays in
 *   LOCK-STEP with its `upstream/<owner>-<repo>` reference pin. Three
 *   assertions:
 *   1. the port map is TOTAL — a composite dir with no entry fails, so a new
 *      composite can't land silently unpinned; a Socket-original declares `[]`.
 *   2. in the template source, every declared port has a `.gitmodules`
 *      reference block that is release-tagged and sha256-stamped — the
 *      provenance anchor `vendor-actions.mts` provisions.
 *   3. `portedAt` equals the pinned tag — a vendor bump without a re-port
 *      review goes red, which IS the lock-step: upstream moved, so the port
 *      must be re-reviewed against the upstream diff before the map advances.
 *   Composite enumeration prefers `template/{base,conditional/*}` (the
 *   template source owns the composites and the pins); a cascaded member
 *   checks only map totality over its live `.github/actions/fleet/` copies.
 *   Pure filesystem + `.gitmodules` parse — no network, so offline/CI never
 *   flakes. No-ops when the repo carries no fleet composites. See
 *   docs/agents.md/fleet/upstream-references.md.
 *   Usage: node scripts/fleet/check/action-ports-are-lock-stepped.mts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import {
  COMPOSITE_ACTION_PORTS,
  upstreamSubmoduleName,
} from '../_shared/action-port-map.mts'
import { parseGitmodules } from '../_shared/gitmodules.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type { CompositePort } from '../_shared/action-port-map.mts'
import type { GitmodulesEntry } from '../_shared/gitmodules.mts'

const logger = getDefaultLogger()

// A release tag carries a `<major>.<minor>` version token — the same rule
// upstream-submodules-are-release-tagged enforces.
const RELEASE_TAG_RE = /\d+\.\d+/

export interface CompositeInventory {
  // Sorted unique composite dir names.
  names: string[]
  // True when enumeration came from template/{base,conditional/*} — the
  // template source, where the pin record lives and both map directions plus
  // the lock-step are enforced.
  templateSource: boolean
}

// Subdirectory names of `<root>` — composites are dirs, never loose files.
function dirNames(root: string): string[] {
  if (!existsSync(root)) {
    return []
  }
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

/**
 * Enumerate the fleet composites this repo carries. Template source: the
 * union of template/base and every template/conditional overlay. Member: the
 * live `.github/actions/fleet/` copies. Pure filesystem.
 */
export function listFleetComposites(repoRoot: string): CompositeInventory {
  const fleetActions = path.join('.github', 'actions', 'fleet')
  const baseRoot = path.join(repoRoot, 'template', 'base', fleetActions)
  const conditionalRoot = path.join(repoRoot, 'template', 'conditional')
  if (existsSync(baseRoot)) {
    const names = new Set<string>(dirNames(baseRoot))
    for (const overlay of dirNames(conditionalRoot)) {
      for (const name of dirNames(
        path.join(conditionalRoot, overlay, fleetActions),
      )) {
        names.add(name)
      }
    }
    return { names: [...names].toSorted(), templateSource: true }
  }
  return {
    names: dirNames(path.join(repoRoot, fleetActions)).toSorted(),
    templateSource: false,
  }
}

export interface PortMapGaps {
  // Composite dirs with no port-map entry — a new composite that omitted its
  // mapping.
  undeclared: string[]
  // Port-map keys with no composite dir — a renamed/removed composite left a
  // stale entry. Only meaningful in the template source, where every key must
  // resolve.
  stale: string[]
}

/**
 * The two totality directions between the composite inventory and the port
 * map. Pure.
 */
export function findPortMapGaps(
  inventory: CompositeInventory,
  portMap: Readonly<
    Record<string, readonly CompositePort[]>
  > = COMPOSITE_ACTION_PORTS,
): PortMapGaps {
  const keys = new Set(Object.keys(portMap))
  const undeclared = inventory.names.filter(name => !keys.has(name))
  const stale = inventory.templateSource
    ? [...keys].filter(key => !inventory.names.includes(key)).toSorted()
    : []
  return { stale, undeclared }
}

/**
 * Lock-step violations between the declared ports and the `.gitmodules`
 * reference pins: a missing block, a block whose pinned `branch` tag is not a
 * release tag, a missing `sha256:` stamp, or `portedAt` !== the pinned tag —
 * the re-port tripwire. Pure.
 */
export function findLockstepViolations(
  entries: readonly GitmodulesEntry[],
  portMap: Readonly<
    Record<string, readonly CompositePort[]>
  > = COMPOSITE_ACTION_PORTS,
): string[] {
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  const violations: string[] = []
  const composites = Object.keys(portMap).toSorted()
  for (let i = 0, { length } = composites; i < length; i += 1) {
    const composite = composites[i]!
    for (const port of portMap[composite]!) {
      const sub = upstreamSubmoduleName(port.upstream)
      const entry = byName.get(sub)
      if (!entry) {
        violations.push(
          `${composite}: ports ${port.upstream} but .gitmodules has no "${sub}" block — run \`node scripts/fleet/vendor-actions.mts\``,
        )
        continue
      }
      if (!entry.branch || !RELEASE_TAG_RE.test(entry.branch)) {
        violations.push(
          `${composite}: ${sub} pins branch "${entry.branch ?? '(unset)'}" — not a release tag`,
        )
      }
      if (!entry.headerSha) {
        violations.push(
          `${composite}: ${sub} has no \`sha256:\` content-hash stamp — run \`node scripts/fleet/gen/gitmodules-hash.mts --write\``,
        )
      }
      if (entry.branch && port.portedAt !== entry.branch) {
        violations.push(
          `${composite}: ported at ${port.portedAt} but ${port.upstream} is pinned at ${entry.branch} — re-review the port against the upstream diff, then bump portedAt`,
        )
      }
    }
  }
  return violations
}

/**
 * Fail the gate when the port map is not total, a declared port lacks its
 * pinned + stamped reference block, or a pin advanced past `portedAt`.
 * Returns the exit code (0 = compliant / no composites, 1 = violation).
 * `portMap` is injectable for tests; production runs on the canonical map.
 */
export function runCheck(
  repoRoot: string,
  portMap: Readonly<
    Record<string, readonly CompositePort[]>
  > = COMPOSITE_ACTION_PORTS,
): number {
  const inventory = listFleetComposites(repoRoot)
  if (inventory.names.length === 0) {
    return 0
  }
  const problems: string[] = []
  const gaps = findPortMapGaps(inventory, portMap)
  for (const name of gaps.undeclared) {
    problems.push(
      `${name}: no port-map entry — declare what it ports in scripts/fleet/_shared/action-port-map.mts, or \`[]\` for a Socket-original`,
    )
  }
  for (const key of gaps.stale) {
    problems.push(
      `${key}: port-map entry has no composite dir — remove the stale entry`,
    )
  }
  // The pin record is template-source-owned; members only mirror composites.
  if (inventory.templateSource) {
    const gitmodulesPath = path.join(repoRoot, '.gitmodules')
    const entries = existsSync(gitmodulesPath)
      ? parseGitmodules(readFileSync(gitmodulesPath, 'utf8'))
      : []
    problems.push(...findLockstepViolations(entries, portMap))
  }
  if (problems.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[action-ports-are-lock-stepped] Composite ports are out of lock-step with their upstream pins.',
      '',
      '  Fleet policy: every .github/actions/fleet/* composite declares its ported',
      '  upstream(s) in the port map, every port has a release-tagged + sha256-stamped',
      '  upstream/ reference block, and portedAt equals the pinned tag. Offenders:',
      ...problems.map(p => `    - ${p}`),
      '',
    ].join('\n'),
  )
  return 1
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = runCheck(REPO_ROOT)
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
}
