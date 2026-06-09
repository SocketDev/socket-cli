/**
 * @file Shared catalog of secret-bearing env-var key names. Used by every hook
 *   that scans for accidentally-checked-in or accidentally-printed
 *   credentials:
 *
 *   - token-guard (Bash): blocks commands that print these to stdout.
 *   - no-token-in-dotenv-guard (Edit|Write): blocks writing these to `.env` /
 *     `.env.local` / similar dotfiles.
 *   - (future) repo-wide secret scanner: same catalog feeds a scripts/ gate that
 *     walks the working tree at commit time. Keep the catalog narrow +
 *     auditable. Adding a name here means every consumer will scan for it;
 *     false-positives on legitimate config keys (e.g. `FOO_API_VERSION=2.1`)
 *     are real friction. Names follow the published env-var convention of each
 *     tool — when in doubt, prefer the official docs over guessed shapes.
 *     Layout:
 *   - Per-category arrays so consumers can opt out of specific categories if
 *     needed (e.g. an AWS-only repo might not care about Linear).
 *   - `ALL_TOKEN_KEY_PATTERNS` is the flat union used by default.
 *   - `GENERIC_TOKEN_SUFFIX_RE` catches anything ending in `_TOKEN` / `_KEY` /
 *     `_SECRET` after the named lists; consumers decide whether to include it.
 *     The trade-off: catches more leaks but also fires on
 *     `JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY----` etc. The named lists are the
 *     recommended primary pass. If you need to add a name, add it to the
 *     matching category. If the category doesn't exist yet, add it (with a
 *     comment naming the vendor / product) — don't dump it into MISC.
 */

// ── Socket fleet ─────────────────────────────────────────────────────
export const SOCKET_FLEET_TOKEN_PATTERNS: readonly RegExp[] = [
  /^SOCKET_API_(?:KEY|TOKEN)$/,
  /^SOCKET_CLI_API_(?:KEY|TOKEN)$/,
  /^SOCKET_SECURITY_API_(?:KEY|TOKEN)$/,
]

// ── LLM providers ────────────────────────────────────────────────────
// Each entry uses the vendor's published env-var name. CLAUDE_API_KEY
// is included alongside ANTHROPIC_API_KEY because the older `claude`
// CLI variants still ship docs referencing it.
export const LLM_TOKEN_PATTERNS: readonly RegExp[] = [
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
export const VCS_TOKEN_PATTERNS: readonly RegExp[] = [
  /^GH_TOKEN$/,
  /^GITHUB_(?:PAT|TOKEN)$/,
  /^GITLAB_(?:PAT|PRIVATE_TOKEN|TOKEN)$/,
  /^BITBUCKET_(?:APP_PASSWORD|TOKEN)$/,
]

// ── Product tracking / docs ──────────────────────────────────────────
export const PRODUCT_TOKEN_PATTERNS: readonly RegExp[] = [
  /^LINEAR_API_(?:KEY|TOKEN)$/,
  /^NOTION_(?:API_KEY|API_TOKEN|INTEGRATION_TOKEN|TOKEN)$/,
  /^JIRA_API_(?:KEY|TOKEN)$/,
  /^ATLASSIAN_API_(?:KEY|TOKEN)$/,
  /^CONFLUENCE_API_(?:KEY|TOKEN)$/,
  /^ASANA_(?:ACCESS_TOKEN|API_TOKEN|PERSONAL_ACCESS_TOKEN|TOKEN)$/,
  /^TRELLO_(?:API_KEY|API_TOKEN|TOKEN)$/,
  /^MONDAY_API_(?:KEY|TOKEN)$/,
]

// ── Chat / comms ─────────────────────────────────────────────────────
export const CHAT_TOKEN_PATTERNS: readonly RegExp[] = [
  /^SLACK_(?:APP_TOKEN|BOT_TOKEN|SIGNING_SECRET|TOKEN|USER_TOKEN|WEBHOOK_URL)$/,
  /^DISCORD_(?:BOT_TOKEN|TOKEN|WEBHOOK_URL)$/,
  /^TELEGRAM_BOT_TOKEN$/,
  /^TWILIO_(?:API_KEY|API_SECRET|AUTH_TOKEN)$/,
]

// ── Cloud providers ──────────────────────────────────────────────────
export const CLOUD_TOKEN_PATTERNS: readonly RegExp[] = [
  /^AWS_(?:ACCESS|SECRET)_(?:ACCESS_KEY|KEY_ID)$/,
  /^AWS_SESSION_TOKEN$/,
  /^GCP_API_KEY$/,
  /^GOOGLE_(?:APPLICATION_CREDENTIALS|CLIENT_SECRET)$/,
  /^AZURE_(?:API_KEY|CLIENT_SECRET)$/,
  /^DO_(?:ACCESS|API)_TOKEN$/,
  /^CLOUDFLARE_(?:API_KEY|API_TOKEN)$/,
  /^FLY_API_TOKEN$/,
  /^HEROKU_API_KEY$/,
]

// ── Package registries ──────────────────────────────────────────────
export const REGISTRY_TOKEN_PATTERNS: readonly RegExp[] = [
  /^NPM_TOKEN$/,
  /^NODE_AUTH_TOKEN$/,
  /^PYPI_(?:API_TOKEN|TOKEN)$/,
  /^CARGO_REGISTRY_TOKEN$/,
  /^RUBYGEMS_(?:API_KEY|HOST)$/,
  /^MAVEN_(?:PASSWORD|USERNAME)$/,
]

// ── Payments / billing ──────────────────────────────────────────────
export const PAYMENT_TOKEN_PATTERNS: readonly RegExp[] = [
  /^STRIPE_(?:API|PUBLISHABLE|RESTRICTED|SECRET)_KEY$/,
  /^SQUARE_ACCESS_TOKEN$/,
  /^PAYPAL_(?:API_KEY|CLIENT_SECRET)$/,
]

// ── Email / messaging providers ─────────────────────────────────────
export const EMAIL_TOKEN_PATTERNS: readonly RegExp[] = [
  /^SENDGRID_API_KEY$/,
  /^MAILGUN_API_KEY$/,
  /^POSTMARK_(?:API_TOKEN|SERVER_TOKEN)$/,
  /^RESEND_API_KEY$/,
  /^MAILCHIMP_API_KEY$/,
]

// ── Observability ───────────────────────────────────────────────────
export const OBSERVABILITY_TOKEN_PATTERNS: readonly RegExp[] = [
  /^DATADOG_(?:API_KEY|APP_KEY)$/,
  /^SENTRY_(?:AUTH_TOKEN|DSN)$/,
  /^NEW_RELIC_(?:API_KEY|LICENSE_KEY)$/,
  /^HONEYCOMB_API_KEY$/,
  /^GRAFANA_API_KEY$/,
  /^LOGTAIL_(?:API_KEY|TOKEN)$/,
]

// ── CI providers ────────────────────────────────────────────────────
export const CI_TOKEN_PATTERNS: readonly RegExp[] = [
  /^CIRCLECI_(?:API_TOKEN|TOKEN)$/,
  /^TRAVIS_API_TOKEN$/,
  /^BUILDKITE_API_TOKEN$/,
  /^DRONE_(?:API_TOKEN|TOKEN)$/,
]

/**
 * Flat union of every named category above. Default catalog for consumers that
 * don't need per-category granularity.
 */
export const ALL_TOKEN_KEY_PATTERNS: readonly RegExp[] = [
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
 * Fallback: anything that _looks_ like a token by suffix. Catches vendors not
 * in the named lists at the cost of false-positives on things like
 * `JWT_PUBLIC_KEY` (which is decidedly NOT a secret). Consumers should use this
 * as an additional pass after the named lists, not in place of them.
 *
 * The shape: `<PREFIX>_<SECRET-NOUN>_<KEY|TOKEN|SECRET>` — at least one
 * underscore-separated qualifier word in front of the suffix to avoid matching
 * bare `KEY=`/`TOKEN=` keys (which are usually loop indices, not secrets).
 */
export const GENERIC_TOKEN_SUFFIX_RE =
  /^[A-Z_]*(?:ACCESS|API|AUTH|BOT|CLIENT|PRIVATE|SECRET|SESSION|WEBHOOK)_(?:KEY|SECRET|TOKEN)$/

/**
 * Convenience: returns true if the given key name matches any pattern in
 * `ALL_TOKEN_KEY_PATTERNS`. Doesn't include the generic suffix fallback —
 * callers that want it should test `isTokenKey(key) ||
 * GENERIC_TOKEN_SUFFIX_RE.test(key)`.
 */
export function isTokenKey(key: string): boolean {
  for (let i = 0, { length } = ALL_TOKEN_KEY_PATTERNS; i < length; i += 1) {
    const re = ALL_TOKEN_KEY_PATTERNS[i]!
    if (re.test(key)) {
      return true
    }
  }
  return false
}

/**
 * Substring fragments matched case-insensitively against Bash command text by
 * `token-guard`. Different shape from `ALL_TOKEN_KEY_PATTERNS`: those match a
 * parsed KEY= identifier exactly, these match anywhere in arbitrary command
 * text (`curl -H "Authorization: $TOKEN"` → matches "TOKEN" → flag for
 * inspection).
 *
 * Kept short to minimize false positives. A "PASSWORD" mention in a
 * commit-message body would otherwise trip every commit, so token-guard narrows
 * matches to assignment / flag-value positions rather than any occurrence in
 * arbitrary text.
 */
export const SENSITIVE_NAME_FRAGMENTS: readonly string[] = [
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

export interface SecretValuePattern {
  // The regex that matches the literal secret VALUE shape (not the env-var
  // name) — `AKIA…`, `ghp_…`, `sktsec_…`, a JWT, a PEM header.
  re: RegExp
  // Human label naming the vendor / kind, used in the block message.
  label: string
}

// Literal secret-VALUE shapes — if any matches in arbitrary text, a real
// credential has been pasted somewhere it shouldn't be. Distinct from the
// `*_TOKEN_PATTERNS` above (those match an env-var KEY name). This is the
// single source of truth shared by the Bash-time `token-guard`, the edit-time
// `secret-content-guard`, and the commit-time scanners — one catalog so a new
// vendor shape is added once and every gate picks it up (code is law, DRY).
export const SECRET_VALUE_PATTERNS: readonly SecretValuePattern[] = [
  { re: /sktsec_[A-Za-z0-9]{20,}/, label: 'Socket API key (sktsec_)' },
  { re: /\bvtwn_[A-Za-z0-9_-]{8,}/, label: 'Val Town token (vtwn_)' },
  { re: /\blin_api_[A-Za-z0-9_-]{8,}/, label: 'Linear API token (lin_api_)' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, label: 'Anthropic API key (sk-ant-)' },
  { re: /\bsk-proj-[A-Za-z0-9_-]{20,}/, label: 'OpenAI project key (sk-proj-)' },
  { re: /\bhf_[A-Za-z0-9]{30,}/, label: 'Hugging Face token (hf_)' },
  { re: /\bnpm_[A-Za-z0-9]{36}/, label: 'npm access token (npm_)' },
  { re: /\bdop_v1_[a-f0-9]{64}/, label: 'DigitalOcean PAT (dop_v1_)' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/, label: 'OpenAI/Anthropic-style secret key (sk-)' },
  { re: /\bsk_live_[A-Za-z0-9_-]{16,}/, label: 'Stripe live secret (sk_live_)' },
  { re: /\bsk_test_[A-Za-z0-9_-]{16,}/, label: 'Stripe test secret (sk_test_)' },
  { re: /\bpk_live_[A-Za-z0-9_-]{16,}/, label: 'Stripe live publishable (pk_live_)' },
  { re: /\brk_live_[A-Za-z0-9_-]{16,}/, label: 'Stripe live restricted (rk_live_)' },
  { re: /\bghp_[A-Za-z0-9]{30,}/, label: 'GitHub personal access token (ghp_)' },
  { re: /\bgho_[A-Za-z0-9]{30,}/, label: 'GitHub OAuth token (gho_)' },
  // ghs_ / ghu_ char classes include `.` and `_` to match both the classic
  // opaque format AND the stateless JWT format (≥36 is the min for both).
  { re: /\bghs_[A-Za-z0-9._]{36,}/, label: 'GitHub app server token (ghs_)' },
  { re: /\bghu_[A-Za-z0-9._]{36,}/, label: 'GitHub user access token (ghu_)' },
  { re: /\bghr_[A-Za-z0-9]{30,}/, label: 'GitHub refresh token (ghr_)' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained PAT' },
  { re: /\bglpat-[A-Za-z0-9_-]{16,}/, label: 'GitLab PAT (glpat-)' },
  { re: /\bAKIA[0-9A-Z]{16}/, label: 'AWS access key ID (AKIA)' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token (xox_-)' },
  { re: /\bAIza[0-9A-Za-z_-]{35}/, label: 'Google API key (AIza)' },
  {
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    label: 'JWT',
  },
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/,
    label: 'private key (PEM block)',
  },
]

export interface SecretValueHit {
  label: string
  // The matched secret substring, for the block message. Callers MUST redact
  // before logging if the surface could be public.
  match: string
}

// Return the first secret-VALUE shape matched in `text`, or undefined. Used by
// every secret gate (Bash / edit / commit) so they share one detection list.
export function scanSecretValues(text: string): SecretValueHit | undefined {
  for (let i = 0, { length } = SECRET_VALUE_PATTERNS; i < length; i += 1) {
    const { label, re } = SECRET_VALUE_PATTERNS[i]!
    const m = re.exec(text)
    if (m) {
      return { label, match: m[0] }
    }
  }
  return undefined
}
