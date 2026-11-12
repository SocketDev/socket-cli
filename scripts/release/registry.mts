import semver from 'semver'

import { RELEASE_PACKAGES } from './packages.mts'
import { matchesReleasePolicy } from '../../src/sea/version.mts'

import type { ReleasePolicy } from '../../src/sea/version.mts'

export { RELEASE_PACKAGES }

const REGISTRY_URL = 'https://registry.npmjs.org'

export class ReleaseRegistryError extends Error {
  readonly code: string
  readonly status: number | undefined

  constructor(
    code: string,
    location: string,
    observed: string,
    status?: number,
  ) {
    super(
      '[release] could not confirm registry availability.\n' +
        `  Where: ${location}.\n` +
        `  Saw: ${observed}; wanted a valid registry response or HTTP 404.\n` +
        '  Fix: resolve registry access or choose an unpublished version before releasing.',
    )
    this.code = code
    this.status = status
  }
}

async function readRegistryDocument(
  name: string,
  version: string | undefined,
  fetcher: typeof fetch,
): Promise<Record<string, unknown> | undefined> {
  const url = `${REGISTRY_URL}/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ''}`
  let response: Response
  try {
    response = await fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new ReleaseRegistryError(
      'REGISTRY_REQUEST_FAILED',
      url,
      'a failed request',
    )
  }
  if (response.status === 404) {
    return undefined
  }
  if (response.status !== 200) {
    throw new ReleaseRegistryError(
      'REGISTRY_HTTP_ERROR',
      url,
      `HTTP ${response.status}`,
      response.status,
    )
  }
  let document: unknown
  try {
    document = await response.json()
  } catch {
    throw new ReleaseRegistryError(
      'REGISTRY_INVALID_RESPONSE',
      url,
      'invalid JSON',
      response.status,
    )
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new ReleaseRegistryError(
      'REGISTRY_INVALID_RESPONSE',
      url,
      'a malformed document',
      response.status,
    )
  }
  return document as Record<string, unknown>
}

export async function readPublishedVersion(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  const document = await readRegistryDocument(name, undefined, fetcher)
  if (!document) {
    return undefined
  }
  const tags = document['dist-tags']
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    const latest = (tags as Record<string, unknown>)['latest']
    if (typeof latest === 'string' && semver.valid(latest) === latest) {
      return latest
    }
  }
  throw new ReleaseRegistryError(
    'REGISTRY_INVALID_RESPONSE',
    name,
    'a missing or invalid latest version',
    200,
  )
}

export async function readPublishedVersions(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const document = await readRegistryDocument(name, undefined, fetcher)
  if (!document) {
    return []
  }
  const versions = document['versions']
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
    throw new ReleaseRegistryError(
      'REGISTRY_INVALID_RESPONSE',
      name,
      'a missing or invalid versions map',
      200,
    )
  }
  return Object.keys(versions)
}

export interface ReleaseRegistryPreflight {
  readonly packages: readonly string[]
  readonly version: string
}

export async function assertReleaseVersionsAvailable(
  version: string,
  fetcher: typeof fetch = fetch,
  policy?: ReleasePolicy,
): Promise<ReleaseRegistryPreflight> {
  const prereleasePolicy =
    policy?.mode === 'prerelease-only' ? policy : undefined
  const onPrereleaseMajor =
    prereleasePolicy !== undefined &&
    semver.parse(version)?.major ===
      Number(prereleasePolicy.versionHint.split('.')[0])
  const allowedVersion = prereleasePolicy
    ? onPrereleaseMajor
      ? matchesReleasePolicy(version, prereleasePolicy)
      : semver.parse(version)?.major === 1 &&
        semver.valid(version) === version &&
        !semver.prerelease(version)
    : semver.valid(version) === version && !semver.prerelease(version)
  if (!allowedVersion) {
    throw new TypeError(
      '[release] invalid release version.\n' +
        '  Where: release:preflight --version.\n' +
        `  Saw: ${version}; wanted a version allowed by the release policy.\n` +
        '  Fix: pass --version with the bump step version.',
    )
  }
  const packages = onPrereleaseMajor ? ['socket'] : [...RELEASE_PACKAGES]
  const results = await Promise.allSettled(
    packages.map(async name => {
      const document = await readRegistryDocument(name, version, fetcher)
      if (!document) {
        return
      }
      if (document['name'] !== name || document['version'] !== version) {
        throw new ReleaseRegistryError(
          'REGISTRY_INVALID_RESPONSE',
          `${name}@${version}`,
          'a mismatched version document',
          200,
        )
      }
      throw new ReleaseRegistryError(
        'VERSION_ALREADY_PUBLISHED',
        `${name}@${version}`,
        'an existing package version',
        200,
      )
    }),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }
  return { packages, version }
}
