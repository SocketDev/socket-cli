/*
 * @file The `pkg:npm` override audit: walk every `overrides:` entry this repo
 *   carries and classify what each one buys.
 *
 *   The family pass next door only builds a family that resolved more than
 *   once, so an override that already did its job is invisible to it. This pass
 *   starts from the OVERRIDE side instead, so a single-version family, and a
 *   family with no resolution at all, both still get read.
 *
 *   The roster comes from two maps, never from a hand-copied list:
 *
 *   - `FLEET_CANONICAL_OVERRIDES`, parsed out of the wheelhouse's own
 *     sync-scaffolding pin manifest. These are the entries the cascade writes
 *     into every member, so their count is the fleet-wide payoff number. Member
 *     repos have no manifest, so the map is empty there and every entry reads as
 *     repo-specific.
 *   - The lockfile's `overrides:` section, which is what the resolver actually
 *     applied. pnpm writes a `catalog:` override into the lockfile already
 *     reduced to the version the catalog carries, so the applied value is a
 *     concrete pin and needs no catalog hop.
 *
 *   An entry in the manifest but not in the lockfile is reported, not dropped.
 *   The tree it would be measured against never had it applied, so the honest
 *   answer is `unproven` with that as the reason.
 *
 *   Read-only, all of it: no override is written, no manifest edited, no
 *   install run.
 */

import { existsSync, readFileSync } from 'node:fs'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { isValidVersion } from '@socketsecurity/lib-stable/versions/parse'

import { readPnpmLockfile } from '../../_shared/pnpm-lockfile.mts'
import type { PnpmLockfileGraph } from '../../_shared/pnpm-lockfile.mts'
import {
  resolveOverridePinManifestPath,
  resolvePnpmLockPath,
} from '../../paths.mts'
import { parseOverridePinLiterals } from '../../update/fleet-pins.mts'
import {
  classifyOverrideAudit,
  sortOverrideAuditRows,
} from '../override-audit.mts'
import type {
  OverrideAuditRead,
  OverrideAuditRow,
  OverrideEntry,
} from '../override-audit.mts'
import { satisfiesSemverRange } from '../verdict.mts'
import {
  collectPnpmOverrideEntries,
  parseNpmAliasSpecifier,
  parsePnpmOverrideKey,
} from './npm-declared-ranges.mts'
import {
  buildPnpmReadingContext,
  collectNpmRegistryVersions,
  readPnpmFamilyReading,
} from './npm.mts'

// What an override's value forces: the one version it pins, when the value
// reduces to one, and whether it swaps the package for a different one.
export interface NpmOverridePin {
  readonly pinnedVersion: string | undefined
  readonly redirectsToOtherPackage: boolean
}

/**
 * Reduce an override value to what it forces. An `npm:` value names another
 * package, which is a redirect rather than a version collapse; anything else is
 * a pin when it parses as a single version, and `undefined` when it does not,
 * since a range or a `catalog:` reference names no one version.
 */
export function resolveNpmOverridePin(config: {
  readonly name: string
  readonly value: string
}): NpmOverridePin {
  const { name, value } = config
  const alias = parseNpmAliasSpecifier(value)
  if (alias) {
    return {
      pinnedVersion: isValidVersion(alias.range) ? alias.range : undefined,
      redirectsToOtherPackage: alias.name !== name,
    }
  }
  return {
    pinnedVersion: isValidVersion(value) ? value : undefined,
    redirectsToOtherPackage: false,
  }
}

/**
 * The `FLEET_CANONICAL_OVERRIDES` map, or an empty map when the manifest is
 * absent. Absence is the normal state in a member repo, which carries the
 * cascaded `overrides:` block without the wheelhouse manifest that generates
 * it.
 */
export function readFleetCanonicalOverrides(
  manifestPath: string,
): Map<string, string> {
  if (!existsSync(manifestPath)) {
    return new Map()
  }
  return parseOverridePinLiterals(readFileSync(manifestPath, 'utf8'))
}

/**
 * The roster: one entry per override key across both maps, key-ordered. The
 * applied value wins over the canonical one, because the applied value is what
 * the measured tree resolved under.
 */
export function collectNpmOverrideRoster(config: {
  readonly canonicalOverrides: ReadonlyMap<string, string>
  readonly lockfileOverrides: ReadonlyMap<string, string>
}): readonly OverrideEntry[] {
  const { canonicalOverrides, lockfileOverrides } = config
  const keys = new Set([
    ...canonicalOverrides.keys(),
    ...lockfileOverrides.keys(),
  ])
  const entries: OverrideEntry[] = []
  for (const key of keys) {
    const parsed = parsePnpmOverrideKey(key)
    if (!parsed) {
      continue
    }
    const appliedValue = lockfileOverrides.get(key)
    const value = appliedValue ?? canonicalOverrides.get(key)!
    const pin = resolveNpmOverridePin({ name: parsed.name, value })
    entries.push({
      appliedToTree: appliedValue !== undefined,
      key,
      name: parsed.name,
      origin: canonicalOverrides.has(key) ? 'fleet-canonical' : 'repo-specific',
      pinnedVersion: pin.pinnedVersion,
      redirectsToOtherPackage: pin.redirectsToOtherPackage,
      scopeRange: parsed.scopeRange,
      value,
    })
  }
  return entries.toSorted((a, b) => a.key.localeCompare(b.key))
}

/**
 * Classify every roster entry against the family it forces, reading each
 * family's consumers and declared ranges out of the same pnpm graph the family
 * pass uses.
 */
export function readNpmOverrideAuditRows(config: {
  readonly canonicalOverrides: ReadonlyMap<string, string>
  readonly graph: PnpmLockfileGraph
  readonly repoRoot: string
}): readonly OverrideAuditRow[] {
  const { canonicalOverrides, graph, repoRoot } = config
  const context = buildPnpmReadingContext({ graph, repoRoot })
  const roster = collectNpmOverrideRoster({
    canonicalOverrides,
    lockfileOverrides: collectPnpmOverrideEntries(graph.lines),
  })
  const rows: OverrideAuditRow[] = []
  for (let i = 0, { length } = roster; i < length; i += 1) {
    const entry = roster[i]!
    const resolvedVersions = collectNpmRegistryVersions(
      graph.versionsByName.get(entry.name),
    )
    const reading = readPnpmFamilyReading({
      context,
      name: entry.name,
      resolvedVersions,
    })
    rows.push(
      classifyOverrideAudit({
        entry,
        evidence: reading.evidence,
        satisfies: satisfiesSemverRange,
      }),
    )
  }
  return sortOverrideAuditRows(rows)
}

/**
 * Audit this repo's npm overrides, or say loudly why it could not. An
 * unreadable lockfile is a failure rather than an empty audit: zero rows over a
 * tree nobody read is the false-green that hides a load-bearing override.
 */
export function auditNpmOverrides(config: {
  readonly repoRoot: string
}): OverrideAuditRead {
  const { repoRoot } = config
  const lockfilePath = resolvePnpmLockPath(repoRoot)
  const read = readPnpmLockfile(lockfilePath)
  if (!read.ok) {
    return {
      ok: false,
      reason:
        `cannot read the pnpm lockfile, so no override audit.\n` +
        `  Where: ${lockfilePath}\n` +
        `  Saw vs wanted: ${read.problem} (${read.reason}); wanted a readable ` +
        `pnpm-lock.yaml\n` +
        `  Fix: run \`pnpm install\` from the repo root, then re-run this ` +
        `analysis.`,
    }
  }
  const manifestPath = resolveOverridePinManifestPath(repoRoot)
  let canonicalOverrides: Map<string, string>
  try {
    canonicalOverrides = readFleetCanonicalOverrides(manifestPath)
  } catch (e) {
    return {
      ok: false,
      reason:
        `cannot read the FLEET_CANONICAL_OVERRIDES pin manifest, so the ` +
        `fleet-canonical half of the roster would go unaudited.\n` +
        `  Where: ${manifestPath}\n` +
        `  Saw vs wanted: ${errorMessage(e)}; wanted a readable manifest\n` +
        `  Fix: restore the manifest, or delete it if this repo is a member ` +
        `that carries only the cascaded \`overrides:\` block.`,
    }
  }
  return {
    ok: true,
    rows: readNpmOverrideAuditRows({
      canonicalOverrides,
      graph: read.graph,
      repoRoot,
    }),
  }
}
