/**
 * @file Last-mile secret redaction for text the CLI is about to show a user or
 *   ship to an error reporter.
 *   Every pattern is a NAMED entry so each shape gets its own unit test and its
 *   own review. One giant regex is unreviewable and untestable.
 *   Order matters. The assignment shape runs first so
 *   `OPENAI_API_KEY=sk-proj-…` collapses to `OPENAI_API_KEY=[redacted]` in one
 *   pass instead of leaving a half-redacted remnant behind. The URL
 *   query-parameter shape runs last because it only has to catch what the
 *   assignment shape cannot: percent-encoded `?`, `&`, and `=` delimiters.
 *   Bias is toward over-redaction. This runs on error output, where hiding one
 *   word of a diagnostic costs far less than printing a live credential into a
 *   terminal, a CI log, or a Sentry event.
 *   Deliberately absent: bare long-hex matching. Socket API tokens can be long
 *   hex, but so is every git SHA, sha256 digest, and integrity hash the CLI
 *   reports, and redacting those would gut the diagnostics.
 */

/**
 * Text substituted for a matched credential.
 */
export const SECRET_REDACTION_PLACEHOLDER = '[redacted]'

export type SecretRedactionPattern = {
  /**
   * Stable identifier used by tests and review.
   */
  name: string
  /**
   * Global regular expression matching the credential shape.
   */
  re: RegExp
  /**
   * Replacement text, may reference capture groups.
   */
  replace: string
}

export const SECRET_REDACTION_PATTERNS: readonly SecretRedactionPattern[] = [
  {
    // `TOKEN=value`, `"clientSecret":"value"`, `x-api-key: value`, and the
    // backslash-escaped variants that appear when JSON is nested in JSON.
    // The leading `[A-Za-z0-9_-]{0,64}` lets a prefix such as `SOCKET_CLI_API_`
    // or `db` sit in front of the keyword.
    // The `(?!\[redacted\])` lookahead keeps the redactor idempotent: the
    // value class stops at `]`, so without it a second pass over an already
    // redacted string would append another placeholder. It tracks
    // SECRET_REDACTION_PLACEHOLDER, which a unit test pins.
    name: 'credential-assignment',
    re: /(\b[A-Za-z0-9_-]{0,64}(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|token|secret|credential|signature|sig|password|passwd)\b(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)(?!\[redacted\])[^\s"',;}&\\\]]+/giu,
    replace: `$1${SECRET_REDACTION_PLACEHOLDER}`,
  },
  {
    // OpenAI-style keys: `sk-…` and `sk-proj-…`.
    name: 'openai-secret-key',
    re: /sk-(?:proj-)?[A-Za-z0-9_*=-]{8,}/gu,
    replace: SECRET_REDACTION_PLACEHOLDER,
  },
  {
    // GitHub personal access, OAuth, server, user, and refresh tokens.
    name: 'github-token',
    re: /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/giu,
    replace: SECRET_REDACTION_PLACEHOLDER,
  },
  {
    // npm granular and legacy automation tokens.
    name: 'npm-token',
    re: /npm_[A-Za-z0-9_-]{8,}/giu,
    replace: SECRET_REDACTION_PLACEHOLDER,
  },
  {
    // Socket API tokens. `TOKEN_PREFIX` in constants/socket.mts is `sktsec_`;
    // this stays a literal so the redactor keeps zero imports and can never
    // fail while handling a module-load error.
    name: 'socket-api-token',
    re: /sktsec_[A-Za-z0-9_-]{8,}/giu,
    replace: SECRET_REDACTION_PLACEHOLDER,
  },
  {
    // `Authorization: Bearer <blob>` and the Basic/Token schemes, including the
    // percent-encoded and `+`-encoded separators seen in logged URLs.
    // The `(?=[A-Za-z]*[0-9.%_~+/*=-])` lookahead requires the blob to hold at
    // least one non-letter, so prose such as "Bearer authentication is
    // required" survives while base64, hex, and JWT-shaped credentials still
    // match.
    name: 'auth-scheme-header',
    re: /(^|%20|[^A-Za-z0-9_])(Basic|Bearer|Token)((?:%20|\+|\s)\s*)(?=[A-Za-z]*[0-9.%_~+/*=-])[A-Za-z0-9.%_~+/*=-]{8,}/giu,
    replace: `$1$2$3${SECRET_REDACTION_PLACEHOLDER}`,
  },
  {
    // URL userinfo: `https://user:pass@host` → `https://[redacted]@host`.
    name: 'url-userinfo',
    re: /((?:git\+ssh|https?|ssh):\/\/)[^\s/@]+@/giu,
    replace: `$1${SECRET_REDACTION_PLACEHOLDER}@`,
  },
  {
    // Secret-bearing URL query parameters where any of `?`, `&`, or `=` may be
    // percent-encoded (`%3F`, `%26`, `%3D`) — the case the assignment shape
    // above cannot see because there is no literal `=`.
    name: 'url-query-secret',
    re: /((?:%26|%3F|[?&])(?:(?!%26|%3D|%3F)[A-Za-z0-9_.%[\]-]){0,64}(?:api(?:%2D|%5F|[_-])?key|access(?:%2D|%5F|[_-])?key(?:(?:%2D|%5F|[_-])?id)?|token|secret|credential|signature|sig|password|passwd)(?:%5D|\])?(?:%3D|=))(?!\[redacted\])(?:(?!%26)[^&\s])+/giu,
    replace: `$1${SECRET_REDACTION_PLACEHOLDER}`,
  },
]

/**
 * Replace every credential shape in `text` with `[redacted]`.
 *
 * Pure: no I/O, no state, safe to call from an error handler.
 *
 * @param text - Text that may embed credentials.
 *
 * @returns The text with every matched credential replaced.
 */
export function redactSecretsFromText(text: string): string {
  let result = text
  for (const { re, replace } of SECRET_REDACTION_PATTERNS) {
    result = result.replaceAll(re, replace)
  }
  return result
}
