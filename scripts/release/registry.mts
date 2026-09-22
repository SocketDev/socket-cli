import semver from 'semver'

export const RELEASE_PACKAGES = [
  'socket',
  '@socketsecurity/cli',
  '@socketsecurity/cli-with-sentry',
] as const

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

export interface ReleaseRegistryPreflight {
  readonly packages: readonly string[]
  readonly version: string
}

export async function assertReleaseVersionsAvailable(
  version: string,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseRegistryPreflight> {
  if (semver.valid(version) !== version || semver.prerelease(version)) {
    throw new TypeError(
      '[release] invalid release version.\n' +
        '  Where: release:preflight --version.\n' +
        '  Saw: a missing or non-release version; wanted an exact stable semver.\n' +
        '  Fix: pass --version with the bump step version.',
    )
  }
  const results = await Promise.allSettled(
    RELEASE_PACKAGES.map(async name => {
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
  return { packages: [...RELEASE_PACKAGES], version }
}
