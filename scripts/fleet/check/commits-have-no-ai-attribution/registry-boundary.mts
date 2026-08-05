/**
 * @file The opt-in `--verify-registry` half of the release-boundary
 *   resolution. The offline boundary is a git fact; the version customers
 *   actually install is a registry fact. When they disagree, the offline
 *   boundary is freezing the wrong span of history and the check says so
 *   instead of quietly trusting it.
 *   Reads go through the fleet's own registry clients (`publish-infra/npm` and
 *   `publish-infra/cargo`), which talk to the registry over HTTPS rather than
 *   shelling out to `npm view`. That sidesteps the CLI entirely, including the
 *   `EBADDEVENGINES` refusal a bare `npm` hits inside a pnpm-pinned repo.
 *   Off by default, and never on the path `pnpm run check` takes: a gate that
 *   needs the network is a gate that goes red on a plane.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'

import {
  findRosterRepo,
  loadRosterFromRepo,
  normalizePublishTargets,
  resolveRepoName,
} from '../../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import { loadSocketWheelhouseConfig } from '../../paths.mts'
import { fetchPublishedVersionChecked } from '../../publish-infra/cargo/registry.mts'
import { fetchLatestPublishedVersionChecked } from '../../publish-infra/npm/registry.mts'
import { resolveNpmWorkspaceLayout } from '../../publish-infra/npm/workspace.mts'

import type { FleetPublishTarget } from '../../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import type { ReleaseBoundary } from './release-boundary.mts'

/**
 * The registries a fleet member can publish its primary artifact to.
 */
export type BoundaryRegistry = 'crates' | 'npm'

/**
 * What is published, and where.
 */
export interface RegistryTarget {
  readonly registry: BoundaryRegistry
  readonly packageName: string
}

/**
 * The release channels a `latest` read can actually see: an npm package
 * (`js`) or a crates.io crate (`cargo`). A member shipping only through some
 * other channel — signed binaries on a GitHub release, a marketplace
 * extension, an action consumed straight from the git tree — has no published
 * `latest` anywhere this check can read.
 */
export const REGISTRY_PUBLISH_TARGETS: readonly FleetPublishTarget[] = [
  'cargo',
  'js',
]

/**
 * Why the registry comparison did not run. `reason` completes the sentence
 * "registry check skipped: …".
 */
export interface RegistryBoundarySkip {
  readonly reason: string
  readonly skipped: true
}

/**
 * The verdict of comparing the offline boundary against the published
 * `latest`. `agrees: false` is the loud case the flag exists to surface.
 */
export interface RegistryBoundaryVerdict {
  readonly agrees: boolean
  readonly boundaryVersion: string | undefined
  readonly detail: string
  readonly packageName: string
  readonly publishedLatest: string | undefined
  readonly reachable: boolean
  readonly registry: BoundaryRegistry
}

/**
 * What a `--verify-registry` run has to report: either the comparison ran and
 * produced a verdict, or the roster said there was nothing to compare.
 */
export type RegistryBoundaryOutcome =
  | RegistryBoundarySkip
  | RegistryBoundaryVerdict

/**
 * True when the outcome is a skip rather than a comparison, so the caller can
 * print the reason and pass instead of reading a verdict that was never made.
 */
export function isRegistryBoundarySkip(
  outcome: RegistryBoundaryOutcome,
): outcome is RegistryBoundarySkip {
  return 'skipped' in outcome
}

/**
 * The version a release tag names, or undefined when the tag is not a release
 * tag at all. Handles the three tag shapes the fleet ships: `v1.2.3`, a bare
 * `1.2.3`, and a `release/1.2.3` prefix.
 */
export function parseTagVersion(tag: string): string | undefined {
  const match = /(?:^|\/)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(
    tag.trim(),
  )
  return match ? match[1] : undefined
}

/**
 * The npm release subject this repo bumps and publishes, resolved through the
 * fleet's own workspace layout reader rather than by reading the root
 * `package.json` name. The layout reader knows the shapes a bare manifest read
 * gets wrong — a publishConfig redirect, a workspace whose publishable member
 * is not the root. Undefined when the repo has no npm release subject at all.
 */
export function resolveNpmSubjectName(repoRoot: string): string | undefined {
  try {
    const name = resolveNpmWorkspaceLayout(repoRoot).subject?.name
    return name || undefined
  } catch {
    return undefined
  }
}

/**
 * The `[package] name` of a Cargo manifest, read with a narrow scan rather
 * than a TOML parser: only the first `name = "…"` inside the `[package]`
 * table counts, so a dependency's name can never be mistaken for the crate's.
 */
export function readCargoPackageName(manifestPath: string): string | undefined {
  if (!existsSync(manifestPath)) {
    return undefined
  }
  let text: string
  try {
    text = readFileSync(manifestPath, 'utf8')
  } catch {
    return undefined
  }
  let inPackageTable = false
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line.startsWith('[')) {
      inPackageTable = line === '[package]'
      continue
    }
    if (!inPackageTable) {
      continue
    }
    const match = /^name\s*=\s*["']([^"']+)["']/.exec(line)
    if (match) {
      return match[1]
    }
  }
  return undefined
}

/**
 * What this repo publishes, derived from the member config's `build.from` and
 * the matching manifest. Undefined for a repo that publishes no registry
 * artifact (a `github-release` producer, say), which makes the flag a no-op
 * rather than a failure.
 */
export function resolveRegistryTarget(
  repoRoot: string,
): RegistryTarget | undefined {
  const config = loadSocketWheelhouseConfig(repoRoot)
  const build = config ? config.value['build'] : undefined
  const from = isPlainObject(build) ? build['from'] : undefined
  if (from === 'crates-registry') {
    const packageName = readCargoPackageName(path.join(repoRoot, 'Cargo.toml'))
    return packageName ? { packageName, registry: 'crates' } : undefined
  }
  if (from === 'npm-registry') {
    const packageName = resolveNpmSubjectName(repoRoot)
    return packageName ? { packageName, registry: 'npm' } : undefined
  }
  return undefined
}

/**
 * The published `latest` for a target, keeping the registry's own three-way
 * answer: a version, "answered but never published", or "could not be
 * consulted".
 */
export async function fetchPublishedLatest(
  target: RegistryTarget,
): Promise<{ latest: string | undefined; reachable: boolean }> {
  const read =
    target.registry === 'crates'
      ? await fetchPublishedVersionChecked(target.packageName)
      : await fetchLatestPublishedVersionChecked(target.packageName)
  return read.reachable
    ? { latest: read.latest, reachable: true }
    : { latest: undefined, reachable: false }
}

/**
 * Why the cascade roster says this repo has no registry release to compare
 * against, or undefined when it has one. Each member declares its release
 * channels in the roster's `publishes` field: `["none"]` ships nothing at all,
 * and `["binary"]` ships signed executables on a GitHub release. Neither has an
 * npm or crates.io `latest`, so asking whether the offline boundary matches one
 * is a question with no answer, and failing the repo over it reports a release
 * it never makes.
 *
 * A repo the roster does not list is NOT skipped. Being absent from the roster
 * is not a declaration that nothing ships, so the config-driven comparison
 * stands and the caller keeps its existing behaviour.
 */
export function resolveRegistrySkip(
  repoRoot: string,
): RegistryBoundarySkip | undefined {
  const roster = loadRosterFromRepo(repoRoot)
  if (!roster) {
    return undefined
  }
  const repoName = resolveRepoName(repoRoot)
  if (!repoName) {
    return undefined
  }
  const entry = findRosterRepo(roster, repoName)
  if (!entry) {
    return undefined
  }
  const channels = normalizePublishTargets(entry.publishes)
  if (!channels.length) {
    return undefined
  }
  if (channels.some(channel => REGISTRY_PUBLISH_TARGETS.includes(channel))) {
    return undefined
  }
  return {
    reason: channels.includes('none')
      ? `${repoName} publishes to no registry`
      : `${repoName} publishes to ${channels.join(', ')} only, so there is no npm or crates.io latest to compare`,
    skipped: true,
  }
}

/**
 * Compare the offline boundary against the published `latest`. The roster is
 * consulted first: a member that publishes to no registry is skipped, with the
 * reason, rather than measured against a `latest` it will never have. Returns
 * undefined when the repo publishes nothing to a registry, so the caller can
 * report "nothing to verify" rather than inventing a verdict.
 */
export async function verifyBoundaryAgainstRegistry(
  repoRoot: string,
  boundary: ReleaseBoundary,
): Promise<RegistryBoundaryOutcome | undefined> {
  const skip = resolveRegistrySkip(repoRoot)
  if (skip) {
    return skip
  }
  const target = resolveRegistryTarget(repoRoot)
  if (!target) {
    return undefined
  }
  const { latest, reachable } = await fetchPublishedLatest(target)
  const boundaryTag =
    boundary.kind === 'ancestor-tag' || boundary.kind === 'declared-tag'
      ? boundary.tag
      : undefined
  const boundaryVersion = boundaryTag ? parseTagVersion(boundaryTag) : undefined
  const base = {
    boundaryVersion,
    packageName: target.packageName,
    publishedLatest: latest,
    reachable,
    registry: target.registry,
  }
  if (!reachable) {
    return {
      ...base,
      agrees: false,
      detail: `the ${target.registry} registry could not be consulted, so the offline boundary is unverified`,
    }
  }
  if (latest === undefined) {
    return {
      ...base,
      agrees: boundaryTag === undefined,
      detail:
        boundaryTag === undefined
          ? `${target.packageName} has never been published, matching a line with no release boundary`
          : `${target.packageName} has never been published, yet history is frozen at ${boundaryTag}`,
    }
  }
  if (boundaryTag === undefined) {
    return {
      ...base,
      agrees: false,
      detail: `${target.packageName}@${latest} is published, yet no release boundary resolved on the scanned branch`,
    }
  }
  if (boundaryVersion === undefined) {
    return {
      ...base,
      agrees: false,
      detail: `${target.packageName}@${latest} is what customers install, but the offline boundary ${boundaryTag} is not a release tag`,
    }
  }
  return {
    ...base,
    agrees: boundaryVersion === latest,
    detail:
      boundaryVersion === latest
        ? `the offline boundary matches ${target.packageName}@${latest}`
        : `${target.packageName}@${latest} is what customers install, but the offline boundary resolved ${boundaryVersion}`,
  }
}
