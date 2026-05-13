/**
 * @fileoverview Shared catalog of secret-bearing env-var key names.
 *
 * Used by every hook that scans for accidentally-checked-in or
 * accidentally-printed credentials:
 *
 *   - token-guard (Bash): blocks commands that print these to stdout.
 *   - no-token-in-dotenv-guard (Edit|Write): blocks writing these to
 *     `.env` / `.env.local` / similar dotfiles.
 *   - (future) repo-wide secret scanner: same catalog feeds a scripts/
 *     gate that walks the working tree at commit time.
 *
 * Keep the catalog narrow + auditable. Adding a name here means
 * every consumer will scan for it; false-positives on legitimate
 * config keys (e.g. `FOO_API_VERSION=2.1`) are real friction. Names
 * follow the published env-var convention of each tool — when in
 * doubt, prefer the official docs over guessed shapes.
 *
 * Layout:
 *
 *   - Per-category arrays so consumers can opt out of specific
 *     categories if needed (e.g. an AWS-only repo might not care
 *     about Linear).
 *   - `ALL_TOKEN_KEY_PATTERNS` is the flat union used by default.
 *   - `GENERIC_TOKEN_SUFFIX_RE` catches anything ending in
 *     `_TOKEN` / `_KEY` / `_SECRET` after the named lists; consumers
 *     decide whether to include it. The trade-off: catches more
 *     leaks but also fires on `JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY----`
 *     etc. The named lists are the recommended primary pass.
 *
 * If you need to add a name, add it to the matching category. If
 * the category doesn't exist yet, add it (with a comment naming the
 * vendor / product) — don't dump it into MISC.
 */

// ── Socket fleet ─────────────────────────────────────────────────────
export const SOCKET_FLEET_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^SOCKET_API_(?:TOKEN|KEY)$/,
  /^SOCKET_CLI_API_(?:TOKEN|KEY)$/,
  /^SOCKET_SECURITY_API_(?:TOKEN|KEY)$/,
]

// ── LLM providers ────────────────────────────────────────────────────
// Each entry uses the vendor's published env-var name. CLAUDE_API_KEY
// is included alongside ANTHROPIC_API_KEY because the older `claude`
// CLI variants still ship docs referencing it.
export const LLM_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^ANTHROPIC_API_KEY$/,
  /^CLAUDE_API_KEY$/,
  /^OPENAI_API_KEY$/,
  /^OPENAI_ORG_ID$/,
  /^OPENAI_PROJECT_ID$/,
  /^GEMINI_API_KEY$/,
  /^GOOGLE_AI_(?:API_KEY|STUDIO_KEY)$/,
  /^COHERE_API_KEY$/,
  /^MISTRAL_API_KEY$/,
  /^GROQ_API_KEY$/,
  /^TOGETHER_API_KEY$/,
  /^FIREWORKS_API_KEY$/,
  /^PERPLEXITY_API_KEY$/,
  /^OPENROUTER_API_KEY$/,
  /^DEEPSEEK_API_KEY$/,
  /^XAI_API_KEY$/,
]

// ── Source control / code hosting ───────────────────────────────────
export const VCS_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^GH_TOKEN$/,
  /^GITHUB_(?:TOKEN|PAT)$/,
  /^GITLAB_(?:TOKEN|PAT|PRIVATE_TOKEN)$/,
  /^BITBUCKET_(?:TOKEN|APP_PASSWORD)$/,
]

// ── Product tracking / docs ──────────────────────────────────────────
export const PRODUCT_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^LINEAR_API_(?:TOKEN|KEY)$/,
  /^NOTION_(?:TOKEN|API_KEY|API_TOKEN|INTEGRATION_TOKEN)$/,
  /^JIRA_API_(?:TOKEN|KEY)$/,
  /^ATLASSIAN_API_(?:TOKEN|KEY)$/,
  /^CONFLUENCE_API_(?:TOKEN|KEY)$/,
  /^ASANA_(?:TOKEN|API_TOKEN|PERSONAL_ACCESS_TOKEN|ACCESS_TOKEN)$/,
  /^TRELLO_(?:TOKEN|API_TOKEN|API_KEY)$/,
  /^MONDAY_API_(?:TOKEN|KEY)$/,
]

// ── Chat / comms ─────────────────────────────────────────────────────
export const CHAT_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^SLACK_(?:TOKEN|BOT_TOKEN|USER_TOKEN|APP_TOKEN|WEBHOOK_URL|SIGNING_SECRET)$/,
  /^DISCORD_(?:TOKEN|BOT_TOKEN|WEBHOOK_URL)$/,
  /^TELEGRAM_BOT_TOKEN$/,
  /^TWILIO_(?:AUTH_TOKEN|API_KEY|API_SECRET)$/,
]

// ── Cloud providers ──────────────────────────────────────────────────
export const CLOUD_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^AWS_(?:ACCESS|SECRET)_(?:KEY_ID|ACCESS_KEY)$/,
  /^AWS_SESSION_TOKEN$/,
  /^GCP_API_KEY$/,
  /^GOOGLE_(?:APPLICATION_CREDENTIALS|CLIENT_SECRET)$/,
  /^AZURE_(?:CLIENT_SECRET|API_KEY)$/,
  /^DO_(?:ACCESS|API)_TOKEN$/,
  /^CLOUDFLARE_(?:API_TOKEN|API_KEY)$/,
  /^FLY_API_TOKEN$/,
  /^HEROKU_API_KEY$/,
]

// ── Package registries ──────────────────────────────────────────────
export const REGISTRY_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^NPM_TOKEN$/,
  /^NODE_AUTH_TOKEN$/,
  /^PYPI_(?:TOKEN|API_TOKEN)$/,
  /^CARGO_REGISTRY_TOKEN$/,
  /^RUBYGEMS_(?:API_KEY|HOST)$/,
  /^MAVEN_(?:USERNAME|PASSWORD)$/,
]

// ── Payments / billing ──────────────────────────────────────────────
export const PAYMENT_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^STRIPE_(?:SECRET|API|RESTRICTED|PUBLISHABLE)_KEY$/,
  /^SQUARE_ACCESS_TOKEN$/,
  /^PAYPAL_(?:CLIENT_SECRET|API_KEY)$/,
]

// ── Email / messaging providers ─────────────────────────────────────
export const EMAIL_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^SENDGRID_API_KEY$/,
  /^MAILGUN_API_KEY$/,
  /^POSTMARK_(?:API_TOKEN|SERVER_TOKEN)$/,
  /^RESEND_API_KEY$/,
  /^MAILCHIMP_API_KEY$/,
]

// ── Observability ───────────────────────────────────────────────────
export const OBSERVABILITY_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^DATADOG_(?:API_KEY|APP_KEY)$/,
  /^SENTRY_(?:AUTH_TOKEN|DSN)$/,
  /^NEW_RELIC_(?:LICENSE_KEY|API_KEY)$/,
  /^HONEYCOMB_API_KEY$/,
  /^GRAFANA_API_KEY$/,
  /^LOGTAIL_(?:TOKEN|API_KEY)$/,
]

// ── CI providers ────────────────────────────────────────────────────
export const CI_TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /^CIRCLECI_(?:TOKEN|API_TOKEN)$/,
  /^TRAVIS_API_TOKEN$/,
  /^BUILDKITE_API_TOKEN$/,
  /^DRONE_(?:TOKEN|API_TOKEN)$/,
]

/**
 * Flat union of every named category above. Default catalog for
 * consumers that don't need per-category granularity.
 */
export const ALL_TOKEN_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  ...SOCKET_FLEET_TOKEN_PATTERNS,
  ...LLM_TOKEN_PATTERNS,
  ...VCS_TOKEN_PATTERNS,
  ...PRODUCT_TOKEN_PATTERNS,
  ...CHAT_TOKEN_PATTERNS,
  ...CLOUD_TOKEN_PATTERNS,
  ...REGISTRY_TOKEN_PATTERNS,
  ...PAYMENT_TOKEN_PATTERNS,
  ...EMAIL_TOKEN_PATTERNS,
  ...OBSERVABILITY_TOKEN_PATTERNS,
  ...CI_TOKEN_PATTERNS,
]

/**
 * Fallback: anything that *looks* like a token by suffix. Catches
 * vendors not in the named lists at the cost of false-positives on
 * things like `JWT_PUBLIC_KEY` (which is decidedly NOT a secret).
 * Consumers should use this as an additional pass after the named
 * lists, not in place of them.
 *
 * The shape: `<PREFIX>_<SECRET-NOUN>_<KEY|TOKEN|SECRET>` — at least
 * one underscore-separated qualifier word in front of the suffix to
 * avoid matching bare `KEY=`/`TOKEN=` keys (which are usually loop
 * indices, not secrets).
 */
export const GENERIC_TOKEN_SUFFIX_RE =
  /^[A-Z_]*(?:API|AUTH|ACCESS|SECRET|PRIVATE|CLIENT|BOT|WEBHOOK|SESSION)_(?:TOKEN|KEY|SECRET)$/

/**
 * Convenience: returns true if the given key name matches any
 * pattern in `ALL_TOKEN_KEY_PATTERNS`. Doesn't include the generic
 * suffix fallback — callers that want it should test `isTokenKey(key)
 * || GENERIC_TOKEN_SUFFIX_RE.test(key)`.
 */
export function isTokenKey(key: string): boolean {
  for (const re of ALL_TOKEN_KEY_PATTERNS) {
    if (re.test(key)) {
      return true
    }
  }
  return false
}

/**
 * Substring fragments matched case-insensitively against Bash command
 * text by `token-guard`. Different shape from `ALL_TOKEN_KEY_PATTERNS`:
 * those match a parsed KEY= identifier exactly, these match anywhere
 * in arbitrary command text (`curl -H "Authorization: $TOKEN"` →
 * matches "TOKEN" → flag for inspection).
 *
 * Kept short to minimize false positives. A "PASSWORD" mention in a
 * commit-message body would otherwise trip every commit; token-guard
 * pairs this list with `containsOutsideQuotes()` to skip in-string
 * fragments.
 */
export const SENSITIVE_NAME_FRAGMENTS: ReadonlyArray<string> = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASS',
  'API_KEY',
  'APIKEY',
  'SIGNING_KEY',
  'PRIVATE_KEY',
  'AUTH',
  'CREDENTIAL',
]
