import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type ReleasePolicy =
  | { mode: 'stable-from-hint'; distTag: string }
  | {
      mode: 'prerelease-only'
      versionHint: string
      identifier: string
      distTag: string
    }

type PrereleaseReleasePolicy = Extract<
  ReleasePolicy,
  { mode: 'prerelease-only' }
>

const STABLE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const DIST_TAG = /^[A-Za-z][A-Za-z0-9._-]*$/u

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

export function parseReleasePolicy(value: unknown): ReleasePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Release policy must be an object.')
  }
  const policy = value as Record<string, unknown>
  if (
    typeof policy['distTag'] !== 'string' ||
    !DIST_TAG.test(policy['distTag'])
  ) {
    throw new Error('Release policy must define a valid distTag.')
  }
  if (policy['mode'] === 'stable-from-hint') {
    return { mode: 'stable-from-hint', distTag: policy['distTag'] }
  }
  if (
    policy['mode'] === 'prerelease-only' &&
    typeof policy['versionHint'] === 'string' &&
    STABLE_VERSION.test(policy['versionHint']) &&
    typeof policy['identifier'] === 'string' &&
    /^[A-Za-z0-9-]+$/u.test(policy['identifier'])
  ) {
    const expectedDistTag = `${policy['identifier']}-${policy['versionHint']}`
    if (policy['distTag'] !== expectedDistTag) {
      throw new Error(
        `Prerelease-only release policy must use the ${expectedDistTag} dist-tag.`,
      )
    }
    return {
      mode: 'prerelease-only',
      versionHint: policy['versionHint'],
      identifier: policy['identifier'],
      distTag: policy['distTag'],
    }
  }
  throw new Error(
    'Release policy mode must be stable-from-hint or prerelease-only with a stable versionHint and identifier.',
  )
}

export function matchesReleasePolicy(
  version: string,
  policy: ReleasePolicy,
): boolean {
  if (policy.mode === 'stable-from-hint') {
    return STABLE_VERSION.test(version)
  }
  const prefix = `${policy.versionHint}-${policy.identifier}.`
  return (
    version.startsWith(prefix) &&
    /^(?:0|[1-9]\d*)$/u.test(version.slice(prefix.length))
  )
}

/**
 * Use the release-preparation version when building the configured SEA line.
 * Feature builds on the older release line use rc.0 until a bump prepares a
 * specific prerelease version in package.json.
 */
export function seaVersionForManifestVersion(
  version: string,
  policy: PrereleaseReleasePolicy,
): string {
  const configuredMajor = policy.versionHint.split('.')[0]
  const manifestMajor = version.split('.')[0]
  if (manifestMajor === configuredMajor) {
    if (!matchesReleasePolicy(version, policy)) {
      throw new Error(
        `Package version ${version} does not match the configured SEA prerelease policy.`,
      )
    }
    return version
  }
  return `${policy.versionHint}-${policy.identifier}.0`
}

export function releasePolicyPath(root = REPOSITORY_ROOT): string {
  const candidates = [
    path.join(root, '.config/release.json'),
    path.join(root, 'release.json'),
    path.join(root, '.release.json'),
  ]
  const found = candidates.filter(existsSync)
  if (found.length > 1) {
    throw new Error(
      `Found multiple release configurations: ${found.map(filename => path.relative(root, filename)).join(', ')}. Keep only .config/release.json.`,
    )
  }
  if (found.length === 0) {
    throw new Error(
      `Release configuration not found. Looked for ${candidates.map(filename => path.relative(root, filename)).join(', ')}.`,
    )
  }
  return found[0]!
}

export function readReleasePolicy(root = REPOSITORY_ROOT): ReleasePolicy {
  return parseReleasePolicy(
    JSON.parse(readFileSync(releasePolicyPath(root), 'utf8')) as unknown,
  )
}

/** SEA builds require an explicit prerelease-only release policy. */
export function readSeaReleaseConfig(
  root = REPOSITORY_ROOT,
): PrereleaseReleasePolicy {
  const policy = readReleasePolicy(root)
  if (policy.mode !== 'prerelease-only') {
    throw new Error('Node SEA builds require a prerelease-only release policy.')
  }
  return policy
}

/** SEA prereleases use the final release version as their stable hint. */
export const SEA_RELEASE_POLICY = readSeaReleaseConfig()

const MANIFEST_VERSION = (
  JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  ) as {
    version?: unknown
  }
).version

if (typeof MANIFEST_VERSION !== 'string') {
  throw new Error('Root package.json must define a version for SEA builds.')
}

/** Version reported by the standalone SEA build and its npm prerelease. */
export const SEA_VERSION = seaVersionForManifestVersion(
  MANIFEST_VERSION,
  SEA_RELEASE_POLICY,
)
