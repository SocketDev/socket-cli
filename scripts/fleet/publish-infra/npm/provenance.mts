/*
 * @file The npm SLSA provenance read — "which git commit actually produced
 *   this published artifact?". The registry answers at
 *   `/-/npm/v1/attestations/<name>@<version>`, returning an ARRAY of
 *   attestations. Two traps live in that array and both cost real debugging
 *   time, so they are encoded here once rather than at each call site:
 *
 *   1. Index 0 is npm's own PUBLISH attestation
 *      (`https://github.com/npm/attestation/tree/main/specs/publish/v0.1`),
 *      not the SLSA provenance. It carries no source commit at all, so a
 *      `attestations[0]` read yields nothing and looks like "no provenance".
 *      Select by `predicateType` containing `slsa`, never by position.
 *   2. The payload is a base64 DSSE envelope, not inline JSON.
 *
 *   The source commit lands at
 *   `predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit`, and
 *   its sibling `uri` names the ref the build checked out
 *   (`git+https://github.com/<org>/<repo>@refs/heads/main`).
 *
 *   Every read is classified rather than collapsed to undefined: a registry
 *   that ANSWERED "this version has no provenance" (404) is a different fact
 *   from a registry that could not be reached, and a gate that conflates them
 *   reports a green it did not earn. See
 *   docs/agents.md/fleet/release-tag-escape-hatch.md.
 */

import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'

// Attestation reads are small JSON documents; the registry answers fast or not
// at all, and a release gate must not hang a CI lane on a stalled socket.
const ATTESTATION_TIMEOUT_MS = 15_000

/**
 * The git source an SLSA provenance statement names: the commit that produced
 * the artifact, and the ref URI the build checked out. Either may be absent
 * from a malformed statement, so both are optional and the caller decides.
 */
export interface AttestedGitSource {
  gitCommit: string | undefined
  uri: string | undefined
}

/**
 * A classified attestation read. `unprovenanced` means the registry ANSWERED
 * and this version has no SLSA statement — a fact about the release.
 * `unreadable` means the question could not be asked (offline lane, 5xx,
 * malformed payload) — a fact about the environment. Collapsing the two is how
 * a provenance gate reports a false green.
 */
export type AttestationRead =
  | { detail: string; kind: 'unprovenanced' }
  | { detail: string; kind: 'unreadable' }
  | { kind: 'attested'; source: AttestedGitSource }

/**
 * The registry attestation endpoint for one published version. Scoped names
 * keep their leading `@` (the registry rejects the percent-encoded form) while
 * the scope separator stays encoded, matching `registry.mts`'s packument URLs.
 */
export function npmAttestationUrl(name: string, version: string): string {
  const encoded = encodeURIComponent(name).replace('%40', '@')
  return `${NPM_REGISTRY_URL}/-/npm/v1/attestations/${encoded}@${version}`
}

/**
 * The one attestation in the endpoint's array whose `predicateType` names
 * SLSA. Pure, and the guard against the index-0 publish-attestation trap
 * described in this file's header.
 */
export function selectSlsaAttestation(
  attestations: readonly unknown[],
):
  | { bundle?: unknown | undefined; predicateType?: unknown | undefined }
  | undefined {
  for (let i = 0, { length } = attestations; i < length; i += 1) {
    const entry = attestations[i] as
      | { bundle?: unknown | undefined; predicateType?: unknown | undefined }
      | undefined
    if (
      entry &&
      typeof entry.predicateType === 'string' &&
      entry.predicateType.includes('slsa')
    ) {
      return entry
    }
  }
  return undefined
}

/**
 * Decode a Sigstore bundle's DSSE envelope payload into its in-toto statement.
 * Returns undefined when the bundle is not shaped as expected or the payload
 * is not base64-encoded JSON — an unparseable bundle is `unreadable`, never a
 * pass. Pure.
 */
export function decodeDsseStatement(bundle: unknown): unknown {
  const payload = (
    bundle as
      | { dsseEnvelope?: { payload?: unknown | undefined } | undefined }
      | undefined
  )?.dsseEnvelope?.payload
  if (typeof payload !== 'string' || payload.length === 0) {
    return undefined
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * The git source named by a decoded in-toto SLSA statement, or undefined when
 * the statement carries no resolved dependency. Pure.
 */
export function readStatementGitSource(
  statement: unknown,
): AttestedGitSource | undefined {
  const resolved = (
    statement as
      | {
          predicate?:
            | {
                buildDefinition?:
                  | { resolvedDependencies?: unknown | undefined }
                  | undefined
              }
            | undefined
        }
      | undefined
  )?.predicate?.buildDefinition?.resolvedDependencies
  if (!Array.isArray(resolved) || resolved.length === 0) {
    return undefined
  }
  const first = resolved[0] as
    | {
        digest?: { gitCommit?: unknown | undefined } | undefined
        uri?: unknown | undefined
      }
    | undefined
  const gitCommit = first?.digest?.gitCommit
  const { uri } = first ?? {}
  return {
    gitCommit: typeof gitCommit === 'string' ? gitCommit : undefined,
    uri: typeof uri === 'string' ? uri : undefined,
  }
}

/**
 * Classify a raw attestation-endpoint body. Pure — the whole decode path is
 * unit-testable from a fixture without touching the network, which is what
 * lets the release-tag gate's tests inject a registry seam.
 */
export function classifyAttestationBody(body: unknown): AttestationRead {
  const attestations = (
    body as { attestations?: unknown | undefined } | undefined
  )?.attestations
  if (!Array.isArray(attestations) || attestations.length === 0) {
    return {
      detail: 'the attestation endpoint returned no attestations',
      kind: 'unprovenanced',
    }
  }
  const slsa = selectSlsaAttestation(attestations)
  if (!slsa) {
    const seen = attestations
      .map(a =>
        String((a as { predicateType?: unknown | undefined })?.predicateType),
      )
      .join(', ')
    return {
      detail: `no SLSA predicateType among the attestations (saw: ${seen})`,
      kind: 'unprovenanced',
    }
  }
  const statement = decodeDsseStatement(slsa.bundle)
  if (statement === undefined) {
    return {
      detail: 'the SLSA attestation bundle carried no decodable DSSE payload',
      kind: 'unreadable',
    }
  }
  const source = readStatementGitSource(statement)
  if (!source || !source.gitCommit) {
    return {
      detail:
        'the SLSA statement named no predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit',
      kind: 'unreadable',
    }
  }
  return { kind: 'attested', source }
}

/**
 * A provenance reader — the seam the release-tag gate injects so its tests
 * exercise every branch without a network call.
 */
export type ProvenanceReader = (
  name: string,
  version: string,
) => Promise<AttestationRead>

/**
 * Read `<name>@<version>`'s SLSA provenance from the npm registry. A 404 is
 * the registry ANSWERING that the version has no attestations
 * (`unprovenanced`); every other failure is `unreadable`, so an offline lane
 * can never be mistaken for a clean release.
 */
export async function fetchAttestedGitSource(
  name: string,
  version: string,
): Promise<AttestationRead> {
  try {
    const body = await httpJson<unknown>(npmAttestationUrl(name, version), {
      headers: { accept: 'application/json' },
      timeout: ATTESTATION_TIMEOUT_MS,
    })
    return classifyAttestationBody(body)
  } catch (e) {
    if (e instanceof HttpResponseError && e.response.status === 404) {
      return {
        detail: 'the registry has no attestations for this version (404)',
        kind: 'unprovenanced',
      }
    }
    return {
      detail: `the attestation endpoint could not be read (${e instanceof HttpResponseError ? `HTTP ${e.response.status}` : 'network error'})`,
      kind: 'unreadable',
    }
  }
}
