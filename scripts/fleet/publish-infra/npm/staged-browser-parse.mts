/**
 * @file Pure parsers for the browser-read staged-tarball passback — no
 *   playwright, no I/O, so the challenge detection and payload mapping are
 *   unit-testable in isolation. The browser side (`staged-browser-read.mts`)
 *   reads npm's signed-in `/settings/<scope>/staged-packages?format=json`
 *   endpoint and feeds the raw body here. Mirrors socket-webext's
 *   `src/trusted-publisher/background/staged-fetch.mts` classifier so both the
 *   extension and the publish gate treat a Cloudflare interstitial the same
 *   way (a transient challenge, never a fatal "not valid JSON").
 *   Two rules run the classification. Challenge COPY is matched against a
 *   normalized body, never as a literal, because "Just a moment…" ships in a
 *   dozen spellings and the one that gets missed is the one that slips a live
 *   challenge past. And the PAYLOAD decides before anything else: a holding
 *   page has no package data to serve, so a body carrying npm's own data is the
 *   response that was asked for, whatever markup wraps it.
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

/**
 * Text reduced to the one form an interstitial phrase is matched against:
 * lowercase, the HTML entities for space and ellipsis resolved, every ellipsis
 * spelling dropped, and all whitespace collapsed to single spaces.
 *
 * A challenge phrase is not a literal. npm and Cloudflare render "Just a
 * moment…" with a Unicode ellipsis, with three ASCII dots, with no trailing
 * punctuation at all, in any case, and with `&hellip;` or a non-breaking space
 * when the copy arrives HTML-escaped. Enumerating those spellings as regexes is
 * a losing game — one always gets missed, and a missed spelling walks a live
 * challenge straight into `JSON.parse` — so the body is normalized ONCE and the
 * phrases are matched against the normalized form.
 */
export function normalizeChallengeText(value: string): string {
  if (!value) {
    return ''
  }
  return (
    value
      .toLowerCase()
      // The entity spellings npm's server-rendered copy arrives in.
      .replace(/&(?:#160|#xa0|nbsp);/g, ' ')
      .replace(/&(?:#8230|#x2026|hellip);/g, ' ')
      // Both ellipsis spellings, plus any longer run of dots, become a break.
      .replace(/…/g, ' ')
      .replace(/\.{2,}/g, ' ')
      // Every whitespace class, non-breaking space included, collapses.
      .replace(/[\s\u00a0]+/g, ' ')
      .trim()
  )
}

// The holding page's own copy, written the way a person reads it on screen and
// matched against normalizeChallengeText output, so case and trailing
// punctuation are already gone by the time these are compared. None of this
// appears on a served npm page.
const INTERSTITIAL_MARKERS: readonly string[] = [
  'just a moment',
  'checking if the site connection is secure',
  'checking your browser before accessing',
  'verify you are human',
  'verifying you are human',
  'additional verification required',
  'enable javascript and cookies to continue',
]

// Challenge scaffolding that is not copy: Cloudflare's own run identifiers.
// These need no normalization — they are tokens, not sentences — and they are
// decisive on their own.
const INTERSTITIAL_SCAFFOLD_MARKERS: readonly RegExp[] = [
  /cf-(?:browser-verification|challenge|chl-)/i,
  /_cf_chl_/i,
]

// Markers that ride EVERY npm response because the site embeds Cloudflare's
// bot-management script inline. On their own they prove nothing — treating them
// as a challenge made a solved page read as still-challenged forever, so the
// poller re-navigated in a loop the operator could never satisfy.
const AMBIENT_CHALLENGE_MARKERS: readonly RegExp[] = [
  /cdn-cgi\/challenge-platform\//i,
  /challenges\.cloudflare\.com\/turnstile/i,
]

// Content that only a SERVED page carries. Its presence settles an ambient
// marker: the page rendered, so whatever challenge ran has already cleared.
const SERVED_PAGE_MARKERS: readonly RegExp[] = [
  /id="github-repoInfo"/,
  /Trusted [Pp]ublish(?:er|ing)/,
  /publishingAccess/,
  /Publishing access/i,
  /"trustedPublisher\\?"\s*:/,
  /id="app"|__NEXT_DATA__|id="root"/,
]

/**
 * Content that proves npm answered with the PACKAGE DATA — the staged-packages
 * envelope's own keys, the access payload's keys, and the trusted-publisher
 * form's input names.
 *
 * This is the decisive signal in the whole classifier. A real interstitial has
 * no package data to serve: it is a holding page, so it carries none of these.
 * A body carrying any of them is therefore the response that was asked for,
 * whatever markup or copy renders around it.
 */
const PAYLOAD_MARKERS: readonly RegExp[] = [
  /\\?"stagedVersions\\?"\s*:/,
  /\\?"stagedPublishingEnabled\\?"\s*:/,
  /\\?"approveURL\\?"\s*:/,
  /\\?"rejectURL\\?"\s*:/,
  /\\?"oidcConnections\\?"\s*:/,
  /\\?"oidcPermissionsEnabled\\?"\s*:/,
  /\\?"canEditPackage\\?"\s*:/,
  /\\?"publishingAccess\\?"\s*:/,
  // The rendered trusted-publisher form, by the input names the fleet driver
  // fills. A form on screen is as good a receipt as the payload behind it.
  /<input[^>]+name="(?:githubEnvironmentName|repositoryName|repositoryOwner|workflowName)"/i,
  /name="(?:allowPublish|allowStagePublish)"/,
]

function matchesAny(body: string, patterns: readonly RegExp[]): boolean {
  for (let i = 0, { length } = patterns; i < length; i += 1) {
    if (patterns[i]!.test(body)) {
      return true
    }
  }
  return false
}

/**
 * Whether `body` carries npm's own package data — the staged-packages
 * envelope, the access payload, or the rendered trusted-publisher form.
 */
export function hasPayloadMarkers(body: string): boolean {
  return !!body && matchesAny(body, PAYLOAD_MARKERS)
}

/**
 * Whether `body` is a Cloudflare bot-challenge INTERSTITIAL rather than the
 * page or JSON that was asked for.
 *
 * Ordered so the decisive facts win. A body carrying the package payload is
 * never a challenge, because a holding page has no package data to serve. Past
 * that there are two tiers, because npm serves Cloudflare's challenge-platform
 * script on ordinary pages: an interstitial-only marker (scaffolding token or
 * normalized holding-page phrase) is decisive, while an ambient marker counts
 * only when no served-page content accompanies it. Without that split a
 * challenge the operator had already solved still read as outstanding, and the
 * pause loop refreshed the same page until its budget ran out.
 */
export function isCloudflareChallenge(body: string): boolean {
  if (!body || hasPayloadMarkers(body)) {
    return false
  }
  if (matchesAny(body, INTERSTITIAL_SCAFFOLD_MARKERS)) {
    return true
  }
  const normalized = normalizeChallengeText(body)
  for (let i = 0, { length } = INTERSTITIAL_MARKERS; i < length; i += 1) {
    if (normalized.includes(INTERSTITIAL_MARKERS[i]!)) {
      return true
    }
  }
  return (
    matchesAny(body, AMBIENT_CHALLENGE_MARKERS) &&
    !matchesAny(body, SERVED_PAGE_MARKERS)
  )
}

// True when a body that should be JSON is actually an HTML document — the
// tell-tale of a challenge/interstitial served in place of the API response.
export function looksLikeHtmlBody(body: string): boolean {
  return /^\s*<(?:!doctype\s+html|body|head|html|title)\b/i.test(body)
}

// Classify a staged-packages response by body + status. The payload decides
// first: a body carrying npm's package data is the response that was asked for,
// so HTML wrapping it is a rendered page, never a challenge. Otherwise HTML
// (challenge markup OR a bare HTML document where JSON was expected, incl. a
// captured 403/503 challenge body) is a `challenge`; a plain 401/403 is `auth`;
// any other non-200 is `error`; a 200 with a non-HTML body is `ok`.
export function classifyStagedFetch(config: {
  body?: string | undefined
  status: number
}): StagedFetchState {
  const cfg = { __proto__: null, ...config } as typeof config
  const body = cfg.body ?? ''
  if (
    !hasPayloadMarkers(body) &&
    (isCloudflareChallenge(body) || looksLikeHtmlBody(body))
  ) {
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
// throw here is a genuine malformed payload, and the message says so rather
// than leaving a bare `Unexpected token <` to read as a challenge.
export function parseStagedPayload(
  body: string,
  packageFilter?: string | undefined,
): StagedPayload {
  if (looksLikeHtmlBody(body)) {
    throw new Error(
      'The staged-packages read got HTML where JSON was expected.\n' +
        '  Where: GET /settings/<scope>/staged-packages?format=json\n' +
        '  Saw:   an HTML document carrying npm page data, not the JSON envelope.\n' +
        '  Wanted: the staged-packages JSON envelope.\n' +
        '  Fix:   re-run the read; if it repeats, npm changed the endpoint and\n' +
        '         staged-browser-parse.mts needs the new shape.',
    )
  }
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
