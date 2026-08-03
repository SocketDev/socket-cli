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

import { loadSocketWheelhouseConfig } from '../../paths.mts'
import { fetchPublishedVersionChecked } from '../../publish-infra/cargo/registry.mts'
import { fetchLatestPublishedVersionChecked } from '../../publish-infra/npm/registry.mts'
import { resolveNpmWorkspaceLayout } from '../../publish-infra/npm/workspace.mts'

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
 * Compare the offline boundary against the published `latest`. Returns
 * undefined when the repo publishes nothing to a registry, so the caller can
 * report "nothing to verify" rather than inventing a verdict.
 */
export async function verifyBoundaryAgainstRegistry(
  repoRoot: string,
  boundary: ReleaseBoundary,
): Promise<RegistryBoundaryVerdict | undefined> {
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
