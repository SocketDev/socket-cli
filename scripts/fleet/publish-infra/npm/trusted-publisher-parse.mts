/**
 * @file Pure parsers for the npm Trusted Publisher settings driver — no
 *   playwright, no network, so the access-page classification and the
 *   form-value extraction are unit-testable from HTML fixtures. The browser
 *   side (`trusted-publisher-page.mts`) reads npm's signed-in
 *   `/package/<pkg>/access` page and feeds the raw HTML here. The read-side
 *   markers (`id="github-repoInfo"` …) mirror socket-webext's
 *   `src/trusted-publisher/background/html-parsing.mts` — npm's form wire
 *   contract, far more stable than DOM structure — so the extension and this
 *   driver read the same page the same way.
 */

import { Value } from '@sinclair/typebox/value'

import {
  OIDC_PERMISSION_ACTIONS,
  OidcConnectionSchema,
} from './access-context-schema.mts'
import type { OidcConnection } from './access-context-schema.mts'
import {
  isCloudflareChallenge,
  looksLikeHtmlBody,
} from './staged-browser-parse.mts'

// Coarse outcome of a GET of `/package/<pkg>/access`. `challenge` exists for
// the Cloudflare interstitial (a 200 HTML page that is NOT the access page);
// `configured`/`unconfigured` are the two readable outcomes.
export type AccessPageState =
  | 'auth'
  | 'challenge'
  | 'configured'
  | 'error'
  | 'unconfigured'

/**
 * Classify an access-page fetch by body + status. Challenge markup wins over
 * everything (a challenge can arrive as a 200, 403, or 503, and treating it
 * as auth/error would abort a batch that only needed a cooldown); a plain
 * 401/403 or a signed-out page is `auth`; any other non-2xx is `error`; a
 * readable page is `configured` when the trusted-publisher summary markers
 * are present, `unconfigured` when only the access-settings shell renders.
 * Pure — exported for tests.
 */
export function classifyAccessPage(config: {
  body?: string | undefined
  status: number
}): AccessPageState {
  const cfg = { __proto__: null, ...config } as typeof config
  const body = cfg.body ?? ''
  if (isCloudflareChallenge(body)) {
    return 'challenge'
  }
  if (cfg.status === 401 || cfg.status === 403) {
    return 'auth'
  }
  if (/sign in to npm/i.test(body) && !/Trusted [Pp]ublish/.test(body)) {
    return 'auth'
  }
  if (cfg.status < 200 || cfg.status >= 400) {
    return 'error'
  }
  // The page's own data wins over its rendered markers: `oidcConnections`
  // carries the live configuration even when the summary markers are absent.
  if (parseOidcConnection(body)) {
    return 'configured'
  }
  if (/id="github-repoInfo"/.test(body)) {
    return 'configured'
  }
  // The React initial-data payload sometimes carries the state as JSON keys
  // instead of rendered markers; quotes may be escaped when embedded.
  if (
    /\\?"trustedPublisher\\?"\s*:/.test(body) ||
    /\\?"trustedPublisherConfigured\\?"\s*:\s*true/.test(body)
  ) {
    return 'configured'
  }
  if (
    /Trusted [Pp]ublish(?:er|ing)/.test(body) ||
    /Publishing access/i.test(body) ||
    /publishingAccess/.test(body)
  ) {
    return 'unconfigured'
  }
  return looksLikeHtmlBody(body) ? 'unconfigured' : 'error'
}

/**
 * The Trusted Publisher form's CURRENT values as read off the access page.
 * `allowedActions` holds the rendered permission strings (`npm publish`,
 * `npm stage publish`) in page order.
 */
export interface TrustedPublisherCurrent {
  allowedActions: string[]
  environmentName: string | undefined
  repositoryName: string | undefined
  repositoryOwner: string | undefined
  workflowFilename: string | undefined
}

/**
 * The access page's `window.__context__` payload carries the configured
 * trusted publisher as DATA — `oidcConnections[]` with the repo, workflow,
 * environment, and permission tokens — while the rendered markers this module
 * also reads are a view of it. Reading the data is exact: a page whose markers
 * are absent (a React shell, a restyled summary) still reports its real
 * configuration, where marker-scraping alone reported "unconfigured" and a
 * caller then planned a create over an existing row.
 *
 * Returns undefined when no connection is present, which is a genuinely
 * unconfigured package. Pure — exported for tests.
 */
export function parseOidcConnection(
  body: string,
): TrustedPublisherCurrent | undefined {
  const marker = body.indexOf('"oidcConnections"')
  if (marker === -1) {
    return undefined
  }
  const open = body.indexOf('[', marker)
  if (open === -1) {
    return undefined
  }
  // Walk to the matching bracket so a nested object never truncates the slice.
  let depth = 0
  let end = -1
  for (let i = open, { length } = body; i < length; i += 1) {
    const ch = body[i]
    if (ch === '[') {
      depth += 1
    } else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.slice(open, end + 1))
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) {
    return undefined
  }
  // Validated against the payload schema rather than duck-typed: a shape change
  // then reads as "no connection" instead of a half-populated row that a caller
  // would diff against and rewrite.
  const connections = parsed.filter((c): c is OidcConnection =>
    Value.Check(OidcConnectionSchema, c),
  )
  const live = connections.find(c => !c.deleted)
  if (!live) {
    return undefined
  }
  const { config } = live
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v !== '' ? v : undefined
  const permissions = live.permissions ?? []
  const allowedActions: string[] = []
  for (let i = 0, { length } = permissions; i < length; i += 1) {
    const token = permissions[i]
    const action =
      typeof token === 'string' ? OIDC_PERMISSION_ACTIONS[token] : undefined
    if (action && !allowedActions.includes(action)) {
      allowedActions.push(action)
    }
  }
  return {
    allowedActions,
    environmentName: str(config.environment_name),
    repositoryName: str(config.repository_name),
    repositoryOwner: str(config.repository_owner),
    workflowFilename: str(config.workflow),
  }
}

/**
 * Parse the configured trusted-publisher summary out of the access page:
 * repo (the `github-repoInfo` marker, `owner/name`), workflow filename,
 * environment name (marker or JSON fallback; absent/empty reads as
 * undefined), and the allowed-action permission strings. Returns undefined
 * when not even the repo marker is present — callers classify first, so
 * that means an unconfigured page. Pure — exported for tests.
 */
export function parseTrustedPublisherForm(
  html: string,
): TrustedPublisherCurrent | undefined {
  // Data before markup: the payload is the page's own state, and it survives a
  // restyle that would break every marker below. Anchored on the
  // `oidcConnections` key, never on markup, chunk names, or integrity hashes —
  // those carry content digests that rotate on every deploy.
  const fromData = parseOidcConnection(html)
  if (fromData) {
    return fromData
  }
  const repo = html.match(/id="github-repoInfo"[^>]*>([^<]+)</)
  const wf = html.match(/id="github-workflowName"[^>]*>([^<]+)</)
  if (!repo && !wf) {
    return undefined
  }
  const repoInfo = (repo?.[1] ?? '').trim()
  const slashIdx = repoInfo.indexOf('/')
  // The environment marker span, else the React initial-data JSON key — whose
  // quotes may be escaped (\") when the JSON sits inside another string.
  const env =
    html.match(/id="github-environmentName"[^>]*>([^<]+)</) ??
    html.match(/\\?"githubEnvironmentName\\?"\s*:\s*\\?"([^"\\]+)\\?"/)
  const envName = (env?.[1] ?? '').trim()
  return {
    allowedActions: extractAllowedActions(html),
    environmentName: envName === '' ? undefined : envName,
    repositoryName:
      slashIdx === -1 ? undefined : repoInfo.slice(slashIdx + 1) || undefined,
    repositoryOwner:
      slashIdx === -1
        ? repoInfo || undefined
        : repoInfo.slice(0, slashIdx) || undefined,
    workflowFilename: (wf?.[1] ?? '').trim() || undefined,
  }
}

/**
 * The allowed-action permission strings on the page, normalized to lowercase
 * single-spaced (`npm publish`, `npm stage publish`). Two page shapes count:
 * the configured summary's `Permissions:` block (spans/codes inside that
 * block ONLY — a page-wide scan would catch unrelated code tags), and the
 * edit form's checked `allowPublish`/`allowStagePublish` checkboxes. Pure —
 * exported for tests.
 */
export function extractAllowedActions(html: string): string[] {
  const actions = new Set<string>()
  // The block between the literal `Permissions:` label's closing span and the
  // next closing div — the region the permission chips render inside.
  const permsBlock = html.match(/Permissions:\s*<\/span>([\s\S]*?)<\/div>/)
  if (permsBlock) {
    const region = permsBlock[1] ?? ''
    // One rendered permission chip: an opening <code …> or <span …> tag, its
    // trimmed text content (captured), then the matching close tag.
    const parts = [
      ...region.matchAll(
        /<(?:code|span)[^>]*>\s*([^<]+?)\s*<\/(?:code|span)>/g,
      ),
    ]
    for (let i = 0, { length } = parts; i < length; i += 1) {
      const t = (parts[i]![1] ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
      if (/^npm (?:stage )?publish$/.test(t)) {
        actions.add(t)
      }
    }
  }
  const checkboxNames: Array<[string, string]> = [
    ['allowPublish', 'npm publish'],
    ['allowStagePublish', 'npm stage publish'],
  ]
  for (let i = 0, { length } = checkboxNames; i < length; i += 1) {
    const [name, action] = checkboxNames[i]!
    // The whole input tag, whatever the attribute order; checkedness is
    // tested on the matched tag text.
    const re = new RegExp(`<input[^>]*\\bname="${name}"[^>]*>`, 'i')
    const m = re.exec(html)
    if (m && /\bchecked\b/i.test(m[0])) {
      actions.add(action)
    }
  }
  return [...actions]
}

/**
 * Whether the allowed-action list grants one of the two publish actions.
 * `publish` means the PLAIN action — `npm stage publish` alone does not
 * grant it. Pure — exported for tests.
 */
export function allowsAction(
  actions: readonly string[],
  action: 'publish' | 'stage-publish',
): boolean {
  for (let i = 0, { length } = actions; i < length; i += 1) {
    const a = actions[i]!.toLowerCase()
    const isStage = /\bnpm\s+stage\s+publish\b/.test(a)
    if (action === 'stage-publish' && isStage) {
      return true
    }
    if (action === 'publish' && !isStage && /\bnpm\s+publish\b/.test(a)) {
      return true
    }
  }
  return false
}
