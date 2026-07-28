/**
 * @file Npm-registry reads for the publish flow: the already-published probe
 *   and the packument trust-metadata fetch (provenance attestations,
 *   staged-publish approver, trusted-publisher attribution).
 */

import crypto from 'node:crypto'

import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'

import type { RegistryLatestRead } from '../../lib/release-anchor.mts'

/**
 * A cache-busting registry read: the packument URL with a unique `_cb` nonce
 * query param appended, plus no-cache request headers layered over `accept`.
 *
 * WHY: the npm registry serves packuments through a CDN that caches them for
 * MINUTES. A release gate that trusts a cached read can see a version that is
 * already LIVE on the registry as ABSENT — or read a stale `dist-tags.latest`
 * — and mis-decide. The @socketregistry/packageurl-js@X.Y.Z near-miss staged
 * an already-published version because both `npm view` and a raw packument
 * fetch were served a stale CDN copy that still showed the prior version. A
 * unique query param defeats the CDN cache key; `Cache-Control: no-cache` +
 * `Pragma: no-cache` defeat any intermediary proxy. Pure — `nonce` is
 * injectable so a test can assert the exact busting applied.
 */
export function cacheBustedRead(
  url: string,
  accept: string,
  nonce: string = crypto.randomUUID(),
): { headers: Record<string, string>; url: string } {
  const separator = url.includes('?') ? '&' : '?'
  return {
    headers: {
      accept,
      'cache-control': 'no-cache',
      pragma: 'no-cache',
    },
    url: `${url}${separator}_cb=${nonce}`,
  }
}

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
  const read = cacheBustedRead(url, 'application/vnd.npm.install-v1+json')
  try {
    const json = await httpJson<{
      'dist-tags'?: { latest?: string | undefined } | undefined
    }>(read.url, {
      headers: read.headers,
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
  /**
   * The LIVE `versions` set — what is public right now. Together with the
   * time map it splits publish history: never published, currently
   * published, and published-then-unpublished.
   */
  versions: string[]
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
  // Full packument — the abbreviated install-v1 format drops `time`.
  const read = cacheBustedRead(url, 'application/json')
  try {
    const json = await httpJson<{
      'dist-tags'?: { latest?: string | undefined } | undefined
      time?: Record<string, string> | undefined
      versions?: Record<string, unknown> | undefined
    }>(read.url, {
      headers: read.headers,
      timeout: 15_000,
    })
    if (!json.time || typeof json.time !== 'object') {
      return undefined
    }
    return {
      latest: json['dist-tags']?.latest,
      timeMap: json.time,
      versions: Object.keys(json.versions ?? {}),
    }
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
  const read = cacheBustedRead(url, 'application/vnd.npm.install-v1+json')
  try {
    const json = await httpJson<{
      versions?: Record<string, unknown> | undefined
    }>(read.url, {
      headers: read.headers,
      timeout: 15_000,
    })
    return Boolean(json.versions && version in json.versions)
  } catch {
    return false
  }
}

/**
 * The registry publish state the verify-before-stage guard reads in one
 * cache-busted packument fetch: the `dist-tags.latest` pointer and every
 * published version string. Returns `{ latest: undefined, versions: [] }` on
 * ANY failure — a version absent from an unreadable packument reads as "not
 * published", so the guard falls through to an ordinary stage attempt (which
 * the registry itself rejects with a 409 if the read was wrong), never a false
 * "already published" skip.
 */
export interface PublishedState {
  latest: string | undefined
  versions: string[]
}

export async function fetchPublishedState(
  name: string,
): Promise<PublishedState> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}`
  const read = cacheBustedRead(url, 'application/vnd.npm.install-v1+json')
  try {
    const json = await httpJson<{
      'dist-tags'?: { latest?: string | undefined } | undefined
      versions?: Record<string, unknown> | undefined
    }>(read.url, {
      headers: read.headers,
      timeout: 15_000,
    })
    return {
      latest: json['dist-tags']?.latest,
      versions: Object.keys(json.versions ?? {}),
    }
  } catch {
    return { latest: undefined, versions: [] }
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
    const accept =
      variant === 'abbreviated'
        ? 'application/vnd.npm.install-v1+json'
        : 'application/json'
    const read = cacheBustedRead(url, accept)
    json = await httpJson<typeof json>(read.url, {
      headers: read.headers,
      timeout: 15_000,
    })
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

/**
 * Post-failure diagnosis for a staged upload under CI OIDC. pnpm's token
 * exchange 404s (`ERR_PNPM_AUTH_TOKEN_EXCHANGE`, logged as "Skipped OIDC")
 * when the registry has NO trusted-publisher registration matching this
 * run's OIDC claims — the upload then proceeds tokenless and fails. The
 * packument's per-version `_npmUser.trustedPublisher` splits the two causes:
 * never registered vs. registered-but-claims-drifted. Returns the diagnosis
 * lines to log (empty outside GitHub Actions).
 */
/**
 * Post-failure diagnosis for a stage-conflict (E409-shaped) upload failure:
 * the target version is NOT publicly published, yet the stage was refused —
 * a staged (unpublished) entry for that exact version already exists, and
 * staging is one-shot per version while an entry lives. The remedy is
 * REJECT-AND-RETRY THE SAME VERSION, never a bump past it: an unpublished
 * version number is not burned, and bumping strands it (the incident shape:
 * a hollow stage survived an incomplete reject, the flow bumped to the next
 * patch, and the hollow entry later went public beside the good one).
 * Returns the lines to log, or [] when the target is already public (the
 * verify-before-stage gate owns that case) or the packument is unreachable.
 */
export async function diagnoseStageConflict(
  name: string,
  version: string,
  options?:
    | {
        fetchState?: ((name: string) => Promise<PublishedState>) | undefined
      }
    | undefined,
): Promise<string[]> {
  const { fetchState = fetchPublishedState } = {
    __proto__: null,
    ...options,
  } as { fetchState?: ((name: string) => Promise<PublishedState>) | undefined }
  const published = await fetchState(name)
  if (published.versions.includes(version)) {
    return []
  }
  return [
    `Probable cause: a staged (unpublished) entry for ${name}@${version} already exists.`,
    `  Where: npm staging — staging is one-shot per version while an entry lives.`,
    `  Saw: the stage was refused, yet ${version} is not visible on the public registry.`,
    `  Fix: as a package maintainer, run \`pnpm stage list\`, then`,
    `  \`pnpm stage reject <stageId>\` for the stale entry, and re-stage the`,
    `  SAME version. Do NOT bump past it: the number is only burned once`,
    `  published, and a surviving stale stage can be approved by mistake later.`,
  ]
}

export async function diagnoseStagedAuthFailure(
  name: string,
): Promise<string[]> {
  if (process.env['GITHUB_ACTIONS'] !== 'true') {
    return []
  }
  const trust = await fetchVersionTrustInfo(name, 'full')
  const trusted = Object.entries(trust).filter(
    ([, info]) => info.trustedPublisher !== undefined,
  )
  const repo = process.env['GITHUB_REPOSITORY'] ?? '<owner>/<repo>'
  const workflowRef = process.env['GITHUB_WORKFLOW_REF'] ?? ''
  const workflow =
    /\/(\.github\/workflows\/[^@]+)@/.exec(workflowRef)?.[1] ??
    '.github/workflows/npm-publish.yml'
  if (trusted.length === 0) {
    return [
      `Probable cause: npm trusted publishing is NOT registered for ${name}.`,
      `  Where: npmjs.com -> ${name} -> Settings -> Trusted publisher.`,
      `  Saw: the packument shows no version ever published via a trusted`,
      `  publisher, and pnpm's token exchange 404 (ERR_PNPM_AUTH_TOKEN_EXCHANGE,`,
      `  logged as "Skipped OIDC") is the no-registration signature; wanted a`,
      `  registration matching repository ${repo}, workflow ${workflow}, and`,
      `  the GitHub environment this workflow binds.`,
      `  Fix: add the trusted publisher with those exact values, then`,
      `  re-dispatch the publish workflow.`,
    ]
  }
  const [latestTrustedVersion, latestInfo] = trusted[trusted.length - 1]!
  return [
    `Probable cause: this run's OIDC claims do not match ${name}'s`,
    `  trusted-publisher registration.`,
    `  Where: npmjs.com -> ${name} -> Settings -> Trusted publisher.`,
    `  Saw: ${latestTrustedVersion} published via trusted publisher`,
    `  ${latestInfo.trustedPublisher?.id ?? '<unknown>'}, but this run presents`,
    `  repository ${repo} and workflow ${workflow}; wanted the registration and`,
    `  the run's claims (repository, workflow file, environment) to agree.`,
    `  Fix: align the npm trusted-publisher entry with this workflow, then`,
    `  re-dispatch.`,
  ]
}
