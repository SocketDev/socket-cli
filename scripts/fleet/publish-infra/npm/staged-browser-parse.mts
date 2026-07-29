/**
 * @file Pure parsers for the browser-read staged-tarball passback — no
 *   playwright, no I/O, so the challenge detection and payload mapping are
 *   unit-testable in isolation. The browser side (`staged-browser-read.mts`)
 *   reads npm's signed-in `/settings/<scope>/staged-packages?format=json`
 *   endpoint and feeds the raw body here. Mirrors socket-webext's
 *   `src/trusted-publisher/background/staged-fetch.mts` classifier so both the
 *   extension and the publish gate treat a Cloudflare interstitial the same
 *   way (a transient challenge, never a fatal "not valid JSON").
 */

// Coarse outcome of a staged-packages fetch. `challenge` is the case this
// exists for: Cloudflare (or any edge interstitial) answers the ?format=json
// request with a 200 HTML page instead of JSON, so classify the BODY, not just
// the status — a naive JSON.parse would throw a misleading parse error.
export type StagedFetchState = 'auth' | 'challenge' | 'error' | 'ok'

/**
 * One staged tarball's identity + its session-scoped download URL.
 */
export interface StagedTarball {
  createdAt?: string | undefined
  id: string
  packageName: string
  shasum?: string | undefined
  tag?: string | undefined
  tarballUrl?: string | undefined
  version: string
}

/**
 * The fields the gate needs off the staged-packages payload envelope.
 */
export interface StagedPayload {
  approveUrl: string
  csrfToken: string
  rejectUrl: string
  tarballs: StagedTarball[]
  total: number
}

// The Cloudflare bot-challenge markers — a challenge body is a 200 (or a
// 403/503) carrying JS-challenge markup, never the JSON we asked for.
export function isCloudflareChallenge(body: string): boolean {
  if (!body) {
    return false
  }
  return (
    /Just a moment/i.test(body) ||
    /cf-(?:browser-verification|challenge|chl-)/i.test(body) ||
    /_cf_chl_/i.test(body) ||
    /cdn-cgi\/challenge-platform\//i.test(body) ||
    /challenges\.cloudflare\.com\/turnstile/i.test(body) ||
    /Checking if the site connection is secure/i.test(body)
  )
}

// True when a body that should be JSON is actually an HTML document — the
// tell-tale of a challenge/interstitial served in place of the API response.
export function looksLikeHtmlBody(body: string): boolean {
  return /^\s*<(?:!doctype\s+html|body|head|html|title)\b/i.test(body)
}

// Classify a staged-packages response by body + status. HTML (challenge markup
// OR a bare HTML document where JSON was expected, incl. a captured 403/503
// challenge body) is a `challenge`; a plain 401/403 is `auth`; any other
// non-200 is `error`; a 200 with a non-HTML body is `ok`.
export function classifyStagedFetch(config: {
  body?: string | undefined
  status: number
}): StagedFetchState {
  const cfg = { __proto__: null, ...config } as typeof config
  const body = cfg.body ?? ''
  if (isCloudflareChallenge(body) || looksLikeHtmlBody(body)) {
    return 'challenge'
  }
  if (cfg.status === 401 || cfg.status === 403) {
    return 'auth'
  }
  if (cfg.status !== 200) {
    return 'error'
  }
  return 'ok'
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

// Map one raw npm staged item to a StagedTarball. The web payload mirrors the
// npm CLI's staged-item fields; read defensively in case the web names differ.
export function mapStagedTarball(raw: Record<string, unknown>): StagedTarball {
  const stagedBy =
    raw['stagedBy'] && typeof raw['stagedBy'] === 'object'
      ? (raw['stagedBy'] as Record<string, unknown>)
      : {}
  return {
    createdAt:
      asString(raw['dateStaged']) ??
      asString(raw['createdAt']) ??
      asString(raw['created']),
    id: asString(raw['stageId']) ?? asString(raw['id']) ?? '',
    packageName: asString(raw['packageName']) ?? asString(raw['name']) ?? '',
    shasum: asString(raw['shasum']),
    tag: asString(raw['tag']),
    tarballUrl:
      asString(stagedBy['tarballUrl']) ??
      asString(raw['tarballUrl']) ??
      asString(raw['tarball']),
    version: asString(raw['version']) ?? '',
  }
}

// Parse the staged-packages JSON body into the envelope + tarball list,
// optionally narrowed to a single package (the list is per-user). Throws on
// non-JSON — the caller classifies challenge bodies BEFORE calling this, so a
// throw here is a genuine malformed payload.
export function parseStagedPayload(
  body: string,
  packageFilter?: string | undefined,
): StagedPayload {
  const payload = JSON.parse(body) as {
    approveURL?: unknown | undefined
    csrftoken?: unknown | undefined
    rejectURL?: unknown | undefined
    stagedVersions?:
      | { objects?: unknown | undefined; total?: unknown | undefined }
      | undefined
  }
  const objects = Array.isArray(payload.stagedVersions?.objects)
    ? (payload.stagedVersions.objects as Array<Record<string, unknown>>)
    : []
  let tarballs = objects.map(mapStagedTarball)
  const filter = (packageFilter ?? '').trim().replace(/^@/, '').toLowerCase()
  if (filter) {
    tarballs = tarballs.filter(t =>
      t.packageName.replace(/^@/, '').toLowerCase().includes(filter),
    )
  }
  return {
    approveUrl: asString(payload.approveURL) ?? '',
    csrfToken: asString(payload.csrftoken) ?? '',
    rejectUrl: asString(payload.rejectURL) ?? '',
    tarballs,
    total:
      typeof payload.stagedVersions?.total === 'number'
        ? payload.stagedVersions.total
        : objects.length,
  }
}
