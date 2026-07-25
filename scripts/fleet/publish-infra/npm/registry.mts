/**
 * @file Npm-registry reads for the publish flow: the already-published probe
 *   and the packument trust-metadata fetch (provenance attestations,
 *   staged-publish approver, trusted-publisher attribution).
 */

import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'

import type { RegistryLatestRead } from '../../lib/release-anchor.mts'

/**
 * The registry `dist-tags.latest` for a package, distinguishing "the registry
 * answered: never published" (a 404 — `reachable: true, latest: undefined`)
 * from "the registry could not be consulted" (network failure, timeout, 5xx —
 * `reachable: false`). Reads the packument (not `npm view`, which trips this
 * repo's pnpm devEngines). The changelog anchor derivation hard-stops on
 * `reachable: false`: offline, the released base cannot be confirmed and a
 * stale local tag would silently widen the range.
 */
export async function fetchLatestPublishedVersionChecked(
  name: string,
): Promise<RegistryLatestRead> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  try {
    const json = await httpJson<{
      'dist-tags'?: { latest?: string | undefined } | undefined
    }>(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      timeout: 15_000,
    })
    return { latest: json['dist-tags']?.latest, reachable: true }
  } catch (e) {
    if (e instanceof HttpResponseError && e.response.status === 404) {
      return { latest: undefined, reachable: true }
    }
    return { reachable: false }
  }
}

/**
 * The registry `dist-tags.latest` for a package — the currently-published
 * version — or undefined on any failure/unpublished. The tolerant twin of
 * reconcile's throwing reader and of `fetchLatestPublishedVersionChecked`:
 * callers that only display or compare a best-effort latest (version-ahead
 * check, reconcile) must NOT throw on a first-publish / offline registry — it
 * returns undefined and the caller falls back.
 */
export async function fetchLatestPublishedVersion(
  name: string,
): Promise<string | undefined> {
  const read = await fetchLatestPublishedVersionChecked(name)
  return read.reachable ? read.latest : undefined
}

/**
 * The registry state the backfill gate reads in one packument fetch: the
 * `dist-tags.latest` pointer plus the `time` map. The time map is the
 * registry's PERMANENT publish ledger — it keeps an entry for every version
 * ever published, including versions later unpublished — so it is the one
 * source that can prove a version was NEVER published. Requires the full
 * packument; the abbreviated format drops `time`.
 */
export interface RegistryReleaseState {
  latest: string | undefined
  timeMap: Record<string, string>
}

/**
 * Fetch `RegistryReleaseState` for a package, or undefined on ANY failure —
 * network, 404, or a packument without a `time` map. The backfill gate fails
 * CLOSED on undefined: an unreadable publish ledger is never treated as an
 * empty one.
 */
export async function fetchRegistryReleaseState(
  name: string,
): Promise<RegistryReleaseState | undefined> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  try {
    const json = await httpJson<{
      'dist-tags'?: { latest?: string | undefined } | undefined
      time?: Record<string, string> | undefined
    }>(url, {
      // Full packument — the abbreviated install-v1 format drops `time`.
      headers: { accept: 'application/json' },
      timeout: 15_000,
    })
    if (!json.time || typeof json.time !== 'object') {
      return undefined
    }
    return { latest: json['dist-tags']?.latest, timeMap: json.time }
  } catch {
    return undefined
  }
}

/**
 * Whether `<name>@<version>` exists on the public registry. An abbreviated
 * packument read (not `npm view`: bare npm invocations die on EBADDEVENGINES
 * inside repos whose devEngines pin pnpm, which made this probe false-negative
 * everywhere — including the release stage's registry-liveness gate). Staged
 * entries are absent from the public packument, so a staged-only version
 * correctly reads as not published. Returns false on any network failure,
 * matching the old exit-code semantics.
 */
export async function isAlreadyPublished(
  name: string,
  version: string,
): Promise<boolean> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  try {
    const json = await httpJson<{
      versions?: Record<string, unknown> | undefined
    }>(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      timeout: 15_000,
    })
    return Boolean(json.versions && version in json.versions)
  } catch {
    return false
  }
}

/**
 * Subset of `https://registry.npmjs.org/<name>` packument fields the fleet's
 * publish scripts care about. The full shape is much larger; we project to what
 * we use so callers don't have to know the rest.
 */
export interface RegistryVersionInfo {
  /**
   * `_npmUser.approver` — set when the version landed through pnpm's staged-
   * publish flow (a human approver clicked through 2FA). Used by
   * `npm/shared.mts:isStagingExpected` to refuse a --direct downgrade when any
   * prior version of the package chose the staged path.
   */
  approver?: string | undefined
  /**
   * `dist.attestations` — present when the upload included npm provenance
   * (`--provenance` flag). The URL fetches the SLSA provenance bundle.
   */
  attestations?:
    | {
        url: string
        provenance: { predicateType: string }
      }
    | undefined
  /**
   * `dist.integrity` — the SRI digest (`sha512-<base64>`) npm recorded for the
   * published tarball. The strong axis of the three-way release hash gate
   * (`lib/verify-release-hashes.mts`).
   */
  integrity?: string | undefined
  /**
   * `dist.shasum` — the sha1 hex digest npm recorded for the published tarball.
   * The fallback axis when `integrity` is unavailable (e.g. a staged version
   * before it is approved).
   */
  shasum?: string | undefined
  /**
   * `_npmUser.trustedPublisher` — set when the version was uploaded via OIDC
   * trusted publisher (GitHub Actions). Omit when classic token was used.
   */
  trustedPublisher?:
    | { id: string; oidcConfigId?: string | undefined }
    | undefined
}

/**
 * Fetch a package's registry packument and return the per-version trust
 * metadata. Returns `{}` for any package that isn't on the registry (or that
 * the fetch itself failed for).
 *
 * The npm registry exposes two packument formats:
 *
 * - Full (~100KB+): includes per-version `_npmUser.trustedPublisher` (OIDC
 *   trusted-publisher attribution) AND `dist.attestations` (SLSA provenance
 *   bundle URL).
 * - Abbreviated (~10-20KB, Accept: application/vnd.npm.install-v1+json): drops
 *   `_npmUser` but keeps `dist.attestations`.
 *
 * Callers pick: `'abbreviated'` for cheap attestation-only checks (Stop-hook,
 * approve-flow enrich), `'full'` for audits that need to confirm
 * trusted-publisher attribution (check/provenance-is-attested.mts).
 *
 * Use this from `check/provenance-is-attested.mts` (CLI audit), the approve
 * flow (show prior-version status), and the Stop-hook (verify a freshly- bumped
 * version landed with provenance).
 */
export async function fetchVersionTrustInfo(
  name: string,
  variant: 'abbreviated' | 'full' = 'abbreviated',
): Promise<Record<string, RegistryVersionInfo>> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  let json: {
    versions?:
      | Record<
          string,
          {
            dist?:
              | {
                  attestations?:
                    | {
                        url: string
                        provenance: { predicateType: string }
                      }
                    | undefined
                  integrity?: string | undefined
                  shasum?: string | undefined
                }
              | undefined
            _npmUser?:
              | {
                  approver?: string | undefined
                  trustedPublisher?:
                    | { id: string; oidcConfigId?: string | undefined }
                    | undefined
                }
              | undefined
          }
        >
      | undefined
  }
  try {
    const headers: Record<string, string> =
      variant === 'abbreviated'
        ? { accept: 'application/vnd.npm.install-v1+json' }
        : { accept: 'application/json' }
    json = await httpJson<typeof json>(url, { headers, timeout: 15_000 })
  } catch {
    return {}
  }
  const result: Record<string, RegistryVersionInfo> = {}
  for (const [version, info] of Object.entries(json.versions ?? {})) {
    result[version] = {
      ...(info._npmUser?.approver !== undefined
        ? { approver: info._npmUser.approver }
        : {}),
      ...(info.dist?.attestations
        ? { attestations: info.dist.attestations }
        : {}),
      ...(info.dist?.integrity !== undefined
        ? { integrity: info.dist.integrity }
        : {}),
      ...(info.dist?.shasum !== undefined ? { shasum: info.dist.shasum } : {}),
      ...(info._npmUser?.trustedPublisher
        ? { trustedPublisher: info._npmUser.trustedPublisher }
        : {}),
    }
  }
  return result
}
