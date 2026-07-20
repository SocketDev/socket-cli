/**
 * @file Npm-registry reads for the publish flow: the already-published probe
 *   and the packument trust-metadata fetch (provenance attestations,
 *   staged-publish approver, trusted-publisher attribution).
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { runCapture } from '../shared.mts'

/**
 * The registry `dist-tags.latest` for a package — the currently-published
 * version — or undefined on any failure/unpublished. Reads the packument (not
 * `npm view`, which trips this repo's pnpm devEngines). The tolerant twin of
 * reconcile's throwing reader: the bump uses it to anchor the base version to
 * what actually published (never a possibly-ahead manifest), so it must NOT
 * throw on a first-publish / offline registry — it returns undefined and the
 * caller falls back.
 */
export async function fetchLatestPublishedVersion(
  name: string,
): Promise<string | undefined> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  try {
    const json = await httpJson<{
      'dist-tags'?: { latest?: string | undefined } | undefined
    }>(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      timeout: 15_000,
    })
    return json['dist-tags']?.latest
  } catch {
    return undefined
  }
}

/**
 * `npm view <name>@<version> version` exits 0 iff the version exists on the
 * registry. Faster than fetching the full packument for a yes/no check.
 */
export async function isAlreadyPublished(
  name: string,
  version: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await runCapture(
    'npm',
    ['view', `${name}@${version}`, 'version'],
    cwd,
  )
  return code === 0
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
