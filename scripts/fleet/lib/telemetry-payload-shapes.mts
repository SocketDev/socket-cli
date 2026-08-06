/**
 * @file The value shapes the telemetry PAYLOAD arm matches, plus the reviewed
 *   baseline recording the ones already judged benign. Split out of
 *   lib/telemetry-payload-scan.mts so the pattern tables and the filesystem
 *   scanner that walks installed packages stay separately readable and
 *   separately testable. This module is pure and does no I/O.
 *   Two shape kinds. A `host` shape names an analytics ingest endpoint: a
 *   bundler cannot erase it, because the request has to name where it posts. A
 *   `key` shape names a public credential whose prefix is unambiguous enough
 *   to gate on, and key matches are redacted to a prefix plus a length before
 *   they reach any output.
 *   Every pattern here is written to be backtracking-free: at most one
 *   unbounded quantifier per run, and never a quantified group whose character
 *   class overlaps what follows it. These patterns run against dependency
 *   bundles, which is attacker-adjacent input, so the matcher must stay linear
 *   on anything it is pointed at.
 */

/**
 * A value shape a telemetry client cannot bundle away. `host` shapes name an
 * analytics ingest endpoint; `key` shapes name a public credential whose
 * prefix is unambiguous. Key matches are REDACTED before they are printed.
 */
export interface TelemetryShape {
  readonly id: string
  readonly kind: 'host' | 'key'
  readonly pattern: RegExp
  readonly vendor: string
}

/**
 * One shape found in some text, with the value already made safe to print.
 */
export interface TelemetryShapeHit {
  readonly display: string
  readonly shape: TelemetryShape
}

/**
 * Ingest hostnames for analytics / error-reporting vendors that receive usage
 * data. A literal host in a shipped bundle is the phone-home destination — it
 * survives minification and treeshaking because the request has to name it.
 * A leading `\b` makes a bare vendor host match every subdomain of it too,
 * since a dot is a word boundary.
 */
export const TELEMETRY_HOST_SHAPES: readonly TelemetryShape[] = [
  {
    id: 'amplitude-ingest',
    kind: 'host',
    pattern: /\bapi2?(?:\.eu)?\.amplitude\.com\b/,
    vendor: 'Amplitude',
  },
  {
    id: 'bugsnag-ingest',
    kind: 'host',
    pattern: /\b(?:notify|sessions)\.bugsnag\.com\b/,
    vendor: 'Bugsnag',
  },
  {
    id: 'datadog-ingest',
    kind: 'host',
    pattern: /\b(?:browser-intake-)?datadoghq\.(?:com|eu)\b/,
    vendor: 'Datadog',
  },
  {
    id: 'fullstory-ingest',
    kind: 'host',
    pattern: /\b(?:edge|rs)\.fullstory\.com\b/,
    vendor: 'FullStory',
  },
  {
    id: 'google-analytics-ingest',
    kind: 'host',
    pattern: /\bgoogle-analytics\.com\b/,
    vendor: 'Google Analytics',
  },
  {
    id: 'google-tag-manager',
    kind: 'host',
    pattern: /\bgoogletagmanager\.com\b/,
    vendor: 'Google Tag Manager',
  },
  {
    id: 'heap-ingest',
    kind: 'host',
    pattern: /\bheapanalytics\.com\b/,
    vendor: 'Heap',
  },
  {
    id: 'langfuse-ingest',
    kind: 'host',
    pattern: /\bcloud\.langfuse\.com\b/,
    vendor: 'Langfuse',
  },
  {
    id: 'logrocket-ingest',
    kind: 'host',
    pattern: /\br\.lr-in[a-z]{0,8}\.(?:com|io)\b/,
    vendor: 'LogRocket',
  },
  // `matomo.php` is Matomo's tracker endpoint path rather than a hostname. A
  // self-hosted Matomo sits on any domain, so that path is the invariant.
  {
    id: 'matomo-ingest',
    kind: 'host',
    pattern: /\b(?:matomo\.cloud|matomo\.php)\b/,
    vendor: 'Matomo',
  },
  {
    id: 'mixpanel-ingest',
    kind: 'host',
    pattern: /\bapi(?:-eu|-js)?\.mixpanel\.com\b/,
    vendor: 'Mixpanel',
  },
  {
    id: 'newrelic-ingest',
    kind: 'host',
    pattern: /\bbam(?:-cell)?\.nr-data\.net\b/,
    vendor: 'New Relic',
  },
  // Scoped to the event endpoint. A bare `plausible.io` is a link in a README
  // or a comparison table far more often than it is an ingest call.
  {
    id: 'plausible-ingest',
    kind: 'host',
    pattern: /\bplausible\.io\/api\/event\b/,
    vendor: 'Plausible',
  },
  {
    id: 'posthog-ingest',
    kind: 'host',
    pattern: /\bposthog\.com\b/,
    vendor: 'PostHog',
  },
  {
    id: 'rollbar-ingest',
    kind: 'host',
    pattern: /\bapi\.rollbar\.com\b/,
    vendor: 'Rollbar',
  },
  {
    id: 'scarf-ingest',
    kind: 'host',
    pattern: /\b(?:scarf\.sh\/package|static\.scarf\.sh)\b/,
    vendor: 'Scarf',
  },
  {
    id: 'segment-ingest',
    kind: 'host',
    pattern: /\b(?:api\.segment\.com|api\.segment\.io|cdn\.segment\.com)\b/,
    vendor: 'Segment',
  },
  {
    id: 'sentry-ingest',
    kind: 'host',
    pattern: /\bingest\.(?:[a-z0-9-]{1,20}\.)?sentry\.io\b/,
    vendor: 'Sentry',
  },
  {
    id: 'statsig-ingest',
    kind: 'host',
    pattern: /\b(?:api\.statsig\.com|featureassets\.org|statsigapi\.net)\b/,
    vendor: 'Statsig',
  },
  // The shape that defeats a vendor-hostname list outright: a first-party
  // subdomain reverse-proxying a vendor's ingest, so no vendor domain appears
  // anywhere in the bundle. The leftmost label set is restricted to labels
  // whose only purpose is phone-home, which is what keeps this cheap enough to
  // gate on. A legitimate match is recorded in the reviewed baseline. The
  // domain tail is one bounded class run, so the matcher stays linear.
  {
    id: 'vendor-proxy-host',
    kind: 'host',
    pattern:
      /\bhttps?:\/\/(?:analytics|beacon|events|ingest|metrics|ph|posthog|telemetry|track)\.[a-z0-9.-]{3,80}/,
    vendor: 'vendor-proxied analytics',
  },
]

/**
 * Public credential shapes whose prefix is unambiguous enough to gate on. A
 * bare 32-hex API key — Amplitude, Mixpanel, Bugsnag, Rollbar — is
 * deliberately NOT here: it is indistinguishable from a hash or an id, and
 * those vendors are already carried by their ingest hostnames above.
 */
export const TELEMETRY_KEY_SHAPES: readonly TelemetryShape[] = [
  {
    id: 'datadog-client-token',
    kind: 'key',
    pattern: /\bpub[0-9a-f]{32}\b/,
    vendor: 'Datadog',
  },
  {
    id: 'google-analytics-property-id',
    kind: 'key',
    pattern: /\bUA-\d{4,9}-\d{1,4}\b/,
    vendor: 'Google Analytics',
  },
  {
    id: 'newrelic-license-key',
    kind: 'key',
    pattern: /\bNR(?:AK|II|JS|RA)-[A-Za-z0-9]{16,64}/,
    vendor: 'New Relic',
  },
  {
    id: 'posthog-project-key',
    kind: 'key',
    pattern: /\bphc_[A-Za-z0-9]{32,64}/,
    vendor: 'PostHog',
  },
  // A Segment write key is 32 base62 with no prefix, so it is only gateable in
  // context: an assignment to a `writeKey` identifier. Mangling erases that
  // identifier, which is why the Segment ingest host above carries the vendor.
  {
    id: 'segment-write-key',
    kind: 'key',
    pattern:
      /\bwrite[_-]?[Kk]ey["']?\s{0,4}[:=]\s{0,4}["'][A-Za-z0-9]{20,64}["']/,
    vendor: 'Segment',
  },
  {
    id: 'sentry-auth-token',
    kind: 'key',
    pattern: /\bsntry[su]?_[A-Za-z0-9]{16,80}/,
    vendor: 'Sentry',
  },
  // A 32-hex userinfo segment in an https URL is a Sentry DSN and nothing
  // else, so the prefix alone carries it and the host tail stays one class run.
  {
    id: 'sentry-dsn',
    kind: 'key',
    pattern: /\bhttps:\/\/[0-9a-f]{32}@[a-z0-9.-]{4,60}\//,
    vendor: 'Sentry',
  },
  {
    id: 'statsig-client-key',
    kind: 'key',
    pattern: /\bclient-[A-Za-z0-9]{40,80}\b/,
    vendor: 'Statsig',
  },
]

/**
 * Every shape the payload arm matches — hosts first, then keys.
 */
export const TELEMETRY_PAYLOAD_SHAPES: readonly TelemetryShape[] = [
  ...TELEMETRY_HOST_SHAPES,
  ...TELEMETRY_KEY_SHAPES,
]

/**
 * One combined alternation over every shape, used as a cheap screen. The
 * overwhelming majority of dependency bundles match nothing, and running 28
 * separate patterns over every chunk of every file to learn that is most of
 * the scan's cost. This runs the regex engine once per chunk; only a chunk
 * that screens positive pays for the per-shape identification pass. Measured
 * on the wheelhouse tree it took a 101 MiB / 5,071-file scan from 5.6s to
 * 1.2s with an identical finding set. Safe to concatenate because every shape
 * pattern uses non-capturing groups only, so no group numbering can collide.
 */
export const TELEMETRY_SHAPE_SCREEN: RegExp = new RegExp(
  TELEMETRY_PAYLOAD_SHAPES.map(s => s.pattern.source).join('|'),
)

/**
 * Payload matches already REVIEWED and accepted, keyed `<package>::<shape-id>`
 * with the reason each is tolerated — the same accept-with-reason shape the
 * name arm's REVIEWED_TELEMETRY uses. The scanner FAILS on any match NOT
 * listed, so a bundled phone-home added by an update is caught.
 *
 * An entry means the match is NOT a destination: a classifier dataset, a
 * documentation fixture, an endpoint allowlist. "It probably never fires" is
 * not a reason — a payload that really can post gets neutralized or dropped,
 * the same as in the name arm. Recording the one match here beats deleting the
 * shape, which would blind the gate for every other package.
 */
export const REVIEWED_TELEMETRY_PAYLOADS: Readonly<Record<string, string>> = {
  __proto__: null,
  // Lighthouse's third-party-web dataset, bundled into the devtools MCP server:
  // a catalog of tracker domains used to CLASSIFY observed network requests.
  // The vendor hostnames are the data being matched against, not a destination
  // the package posts to.
  'chrome-devtools-mcp::fullstory-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  'chrome-devtools-mcp::google-analytics-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  'chrome-devtools-mcp::google-tag-manager':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  'chrome-devtools-mcp::heap-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  'chrome-devtools-mcp::matomo-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  // Lighthouse also bundles a list of known JSONP/tracking URL PATTERNS it
  // recognizes on an analyzed page (`//api.mixpanel.com/track/` sits among
  // `//api.flickr.com/...` and `//pipes.yahooapis.com/...`). Same family as the
  // domain catalog: URLs the scanner matches against, never ones it calls.
  'chrome-devtools-mcp::mixpanel-ingest':
    'Lighthouse recognized-URL pattern list — classification data, not a destination.',
  'chrome-devtools-mcp::newrelic-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  'chrome-devtools-mcp::rollbar-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  'chrome-devtools-mcp::segment-ingest':
    'Lighthouse third-party-web tracker catalog — classification data, not a destination.',
  // A bundled Claude Code shim carries a constant table of accepted API base
  // URLs. `beacon.<host>` matches the vendor-proxy label set, but the entry is
  // an allowlist of endpoints the tool may be POINTED at, not an analytics
  // ingest it posts usage to.
  '@socketsecurity/lib::vendor-proxy-host':
    'Bundled Claude Code shim constant table of accepted API base URLs, not an analytics ingest.',
} as unknown as Record<string, string>

/**
 * Redact a matched credential to its prefix plus a length — enough to identify
 * the vendor and confirm the shape, never enough to reuse the key. Keeps
 * everything up to the last delimiter inside the first 12 characters, so
 * `phc_`, `NRJS-`, and `https://` survive, and falls back to the first 3
 * characters when the match carries no delimiter at all.
 */
export function redactTelemetrySecret(match: string): string {
  let cut = 0
  const scanTo = Math.min(match.length, 12)
  for (let i = 0; i < scanTo; i += 1) {
    const ch = match[i]!
    if (ch === '_' || ch === '-' || ch === ':' || ch === '/' || ch === '=') {
      cut = i + 1
    }
  }
  if (cut === 0) {
    cut = Math.min(3, match.length)
  }
  return `${match.slice(0, cut)}…(${match.length} chars)`
}

/**
 * Every shape present in `text`, one hit per shape. Host matches carry the
 * matched host verbatim; key matches are redacted here, so a caller cannot
 * print a raw credential by accident.
 */
export function scanTextForTelemetryShapes(text: string): TelemetryShapeHit[] {
  const out: TelemetryShapeHit[] = []
  if (!TELEMETRY_SHAPE_SCREEN.test(text)) {
    return out
  }
  for (let i = 0, { length } = TELEMETRY_PAYLOAD_SHAPES; i < length; i += 1) {
    const shape = TELEMETRY_PAYLOAD_SHAPES[i]!
    const matched = shape.pattern.exec(text)
    if (matched) {
      out.push({
        display:
          shape.kind === 'key' ? redactTelemetrySecret(matched[0]) : matched[0],
        shape,
      })
    }
  }
  return out
}

/**
 * The `<package>::<shape-id>` key a finding is reviewed under.
 */
export function telemetryPayloadBaselineKey(
  packageName: string,
  shapeId: string,
): string {
  return `${packageName}::${shapeId}`
}
