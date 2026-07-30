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
