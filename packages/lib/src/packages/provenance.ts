/**
 * @fileoverview Package provenance and attestation verification utilities.
 */

import { NPM_REGISTRY_URL } from '#constants/agents'

import { createCompositeAbortSignal, createTimeoutSignal } from '../abort'
import type { ProvenanceOptions } from '../packages'
import { parseUrl } from '../url'

// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const ArrayIsArray = Array.isArray

const SLSA_PROVENANCE_V0_2 = 'https://slsa.dev/provenance/v0.2'
const SLSA_PROVENANCE_V1_0 = 'https://slsa.dev/provenance/v1'

let _fetcher: typeof import('make-fetch-happen') | undefined
/*@__NO_SIDE_EFFECTS__*/
function getFetcher() {
  if (_fetcher === undefined) {
    const makeFetchHappen =
      /*@__PURE__*/ require('make-fetch-happen')
    // Lazy load constants to avoid circular dependencies.
    const { getPacoteCachePath } =
      /*@__PURE__*/ require('../constants/packages')
    _fetcher = makeFetchHappen.defaults({
      cachePath: getPacoteCachePath(),
      // Prefer-offline: Staleness checks for cached data will be bypassed, but
      // missing data will be requested from the server.
      // https://github.com/npm/make-fetch-happen?tab=readme-ov-file#--optscache
      cache: 'force-cache',
    })
  }
  return _fetcher as typeof import('make-fetch-happen')
}

/**
 * Extract and filter SLSA provenance attestations from attestation data.
 */
function getAttestations(attestationData: unknown): unknown[] {
  const data = attestationData as { attestations?: unknown[] }
  if (!data.attestations || !ArrayIsArray(data.attestations)) {
    return []
  }

  return data.attestations.filter((attestation: unknown) => {
    const att = attestation as { predicateType?: string }
    return (
      att.predicateType === SLSA_PROVENANCE_V0_2 ||
      att.predicateType === SLSA_PROVENANCE_V1_0
    )
  })
}

/**
 * Find the first attestation with valid provenance data.
 */
function findProvenance(attestations: unknown[]): unknown {
  for (const attestation of attestations) {
    const att = attestation as {
      bundle?: { dsseEnvelope?: { payload?: string } }
      predicate?: unknown
    }
    try {
      let predicate = att.predicate

      // If predicate is not directly available, try to decode from DSSE envelope
      if (!predicate && att.bundle?.dsseEnvelope?.payload) {
        try {
          const decodedPayload = Buffer.from(
            att.bundle.dsseEnvelope.payload,
            'base64',
          ).toString('utf8')
          const statement = JSON.parse(decodedPayload)
          predicate = statement.predicate
        } catch {
          // Failed to decode, continue to next attestation
          continue
        }
      }

      const predicateData = predicate as {
        buildDefinition?: { externalParameters?: unknown }
      }
      if (predicateData?.buildDefinition?.externalParameters) {
        return {
          predicate,
          externalParameters: predicateData.buildDefinition.externalParameters,
        }
      }
      // c8 ignore start - Error handling for malformed attestation data should continue processing other attestations.
    } catch {
      // Continue checking other attestations if one fails to parse
    }
    // c8 ignore stop
  }
  return undefined
}

/**
 * Check if a value indicates a trusted publisher (GitHub or GitLab).
 */
function isTrustedPublisher(value: unknown): boolean {
  if (typeof value !== 'string' || !value) {
    return false
  }

  let url = parseUrl(value)
  let hostname = url?.hostname

  // Handle GitHub workflow refs with @ syntax by trying the first part.
  // Example: "https://github.com/owner/repo/.github/workflows/ci.yml@refs/heads/main"
  if (!url && value.includes('@')) {
    const firstPart = value.split('@')[0]
    if (firstPart) {
      url = parseUrl(firstPart)
    }
    if (url) {
      hostname = url.hostname
    }
  }

  // Try common URL prefixes if not already a complete URL.
  if (!url) {
    const httpsUrl = parseUrl(`https://${value}`)
    if (httpsUrl) {
      hostname = httpsUrl.hostname
    }
  }

  if (hostname) {
    return (
      hostname === 'github.com' ||
      hostname.endsWith('.github.com') ||
      hostname === 'gitlab.com' ||
      hostname.endsWith('.gitlab.com')
    )
  }

  // Fallback: check for provider keywords in non-URL strings.
  return value.includes('github') || value.includes('gitlab')
}

/**
 * Convert raw attestation data to user-friendly provenance details.
 */
export function getProvenanceDetails(attestationData: unknown): unknown {
  const attestations = getAttestations(attestationData)
  if (!attestations.length) {
    return undefined
  }
  // Find the first attestation with valid provenance data.
  const provenance = findProvenance(attestations)
  if (!provenance) {
    return { level: 'attested' }
  }

  const provenanceData = provenance as {
    externalParameters?: {
      context?: string
      ref?: string
      repository?: string
      run_id?: string
      sha?: string
      workflow?: {
        ref?: string
        repository?: string
      }
      workflow_ref?: string
    }
    predicate?: {
      buildDefinition?: { buildType?: string }
    }
  }
  const { externalParameters, predicate } = provenanceData
  const def = predicate?.buildDefinition

  // Handle both SLSA v0.2 (direct properties) and v1 (nested workflow object)
  const workflow = externalParameters?.workflow
  const workflowRef = workflow?.ref || externalParameters?.workflow_ref
  const workflowUrl = externalParameters?.context
  const workflowPlatform = def?.buildType
  const repository = workflow?.repository || externalParameters?.repository
  const gitRef = externalParameters?.ref || workflow?.ref
  const commitSha = externalParameters?.sha
  const workflowRunId = externalParameters?.run_id

  // Check for trusted publishers (GitHub Actions, GitLab CI/CD).
  const trusted =
    isTrustedPublisher(workflowRef) ||
    isTrustedPublisher(workflowUrl) ||
    isTrustedPublisher(workflowPlatform) ||
    isTrustedPublisher(repository)

  return {
    commitSha,
    gitRef,
    level: trusted ? 'trusted' : 'attested',
    repository,
    workflowRef,
    workflowUrl,
    workflowPlatform,
    workflowRunId,
  }
}

/**
 * Fetch package provenance information from npm registry.
 */
/*@__NO_SIDE_EFFECTS__*/
export async function fetchPackageProvenance(
  pkgName: string,
  pkgVersion: string,
  options?: ProvenanceOptions,
): Promise<unknown> {
  const { signal, timeout = 10_000 } = {
    __proto__: null,
    ...options,
  } as ProvenanceOptions

  if (signal?.aborted) {
    return undefined
  }

  // Create composite signal combining external signal with timeout
  const timeoutSignal = createTimeoutSignal(timeout)
  const compositeSignal = createCompositeAbortSignal(signal, timeoutSignal)
  const fetcher = getFetcher()

  try {
    const response = await fetcher(
      // The npm registry attestations API endpoint.
      `${NPM_REGISTRY_URL}/-/npm/v1/attestations/${encodeURIComponent(pkgName)}@${encodeURIComponent(pkgVersion)}`,
      {
        method: 'GET',
        signal: compositeSignal,
        headers: {
          'User-Agent': 'socket-registry',
        },
      } as {
        method: string
        signal: AbortSignal
        headers: Record<string, string>
      },
    )
    if (response.ok) {
      return getProvenanceDetails(await response.json())
    }
  } catch {}
  return undefined
}
