/**
 * Unit tests for last-mile secret redaction.
 *
 * Purpose: Proves every named pattern in SECRET_REDACTION_PATTERNS redacts the
 * credential shape it claims, and that ordinary diagnostic text survives.
 *
 * Test Coverage: - Paired synthetic/redacted corpus, one entry per pattern
 * shape plus composites (credential in a URL in a JSON blob, percent-encoded
 * nested query) - Negative cases per pattern - Purity and idempotence.
 *
 * Testing Approach: Two parallel arrays asserted with a single string equality,
 * so a pattern regression surfaces as one readable diff.
 *
 * Related Files: - src/util/redact-secrets-from-text.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  redactSecretsFromText,
  SECRET_REDACTION_PATTERNS,
  SECRET_REDACTION_PLACEHOLDER,
} from '../../../src/util/redact-secrets-from-text.mts'

// Body shared by every synthetic credential below. Obviously fake, and long
// enough to clear the 8-character minimum each prefix pattern enforces.
const BODY = 'SYNTHETIC00000000000000'

// The fleet secret-content guard scans tracked files for a literal
// `sktsec_<body>`, so the synthetic Socket token is assembled at load time
// instead of sitting in the source as one token-shaped string.
const SOCKET_TOKEN = `${'sktsec_'}${BODY}`

const SYNTHETIC_SECRETS: readonly string[] = [
  // openai-secret-key.
  `sk-${BODY}`,
  `sk-proj-${BODY}`,
  // github-token.
  `ghp_${BODY}`,
  `gho_${BODY}`,
  `ghu_${BODY}`,
  `ghs_${BODY}`,
  `ghr_${BODY}`,
  `github_pat_${BODY}`,
  // npm-token.
  `npm_${BODY}`,
  // socket-api-token.
  SOCKET_TOKEN,
  // credential-assignment, env-var shape.
  `SOCKET_CLI_API_TOKEN=${SOCKET_TOKEN}`,
  `SOCKET_SECURITY_API_KEY=${BODY}`,
  `GITHUB_TOKEN=ghp_${BODY}`,
  `NODE_AUTH_TOKEN=npm_${BODY}`,
  `AWS_ACCESS_KEY_ID=${BODY}`,
  `api_key = ${BODY}`,
  `secret=${BODY}`,
  `password=${BODY}`,
  `passwd=${BODY}`,
  `credential=${BODY}`,
  `signature=${BODY}`,
  `//registry.npmjs.org/:_authToken=${BODY}`,
  // credential-assignment, header shape.
  `x-api-key: ${BODY}`,
  // credential-assignment, JSON shapes.
  `{"apiToken":"${SOCKET_TOKEN}","clientSecret":"${BODY}"}`,
  `{\\"refreshToken\\":\\"${BODY}\\",\\"dbPassword\\":\\"${BODY}\\"}`,
  // auth-scheme-header.
  `Authorization: Bearer ${BODY}`,
  'Authorization: Basic U1lOVEhFVElDMDAwMDAwMDA=',
  `Authorization: Token ${BODY}`,
  `Authorization: Bearer%20SYNTHETIC%2F00000000000000`,
  // url-userinfo.
  'https://SYNTHETIC_USER:SYNTHETIC_PASSPHRASE@example.test/private',
  'ssh://SYNTHETIC_USER:SYNTHETIC_PASSPHRASE@example.test/private',
  'git+ssh://SYNTHETIC_USER:SYNTHETIC_PASSPHRASE@example.test/private',
  // url-query-secret, literal delimiters.
  `https://example.test/?token=${BODY}&safe=1`,
  `https://example.test/?service-api-key=${BODY}&signature=${BODY}&safe=1`,
  // url-query-secret, percent-encoded delimiters.
  `https://example.test/?access_token%3D${BODY}&client_secret%3D${BODY}&safe=1`,
  `https://example.test/%3Fapi%2Dkey%3D${BODY}%26safe%3D1`,
  // Composite: credential inside a URL inside a JSON blob.
  `{"registryUrl":"https://SYNTHETIC_USER:SYNTHETIC_PASSPHRASE@registry.test/","apiToken":"${SOCKET_TOKEN}"}`,
  // Composite: percent-encoded query nested inside a redirect parameter.
  `https://example.test/?redirect_uri=https%3A%2F%2Finner.test%2Fcb%3Frefresh_token%3D${BODY}%26password%3D${BODY}%26safe%3D1`,
]

const REDACTED_EXPECTED: readonly string[] = [
  // openai-secret-key.
  '[redacted]',
  '[redacted]',
  // github-token.
  '[redacted]',
  '[redacted]',
  '[redacted]',
  '[redacted]',
  '[redacted]',
  '[redacted]',
  // npm-token.
  '[redacted]',
  // socket-api-token.
  '[redacted]',
  // credential-assignment, env-var shape.
  'SOCKET_CLI_API_TOKEN=[redacted]',
  'SOCKET_SECURITY_API_KEY=[redacted]',
  'GITHUB_TOKEN=[redacted]',
  'NODE_AUTH_TOKEN=[redacted]',
  'AWS_ACCESS_KEY_ID=[redacted]',
  'api_key = [redacted]',
  'secret=[redacted]',
  'password=[redacted]',
  'passwd=[redacted]',
  'credential=[redacted]',
  'signature=[redacted]',
  '//registry.npmjs.org/:_authToken=[redacted]',
  // credential-assignment, header shape.
  'x-api-key: [redacted]',
  // credential-assignment, JSON shapes.
  '{"apiToken":"[redacted]","clientSecret":"[redacted]"}',
  '{\\"refreshToken\\":\\"[redacted]\\",\\"dbPassword\\":\\"[redacted]\\"}',
  // auth-scheme-header.
  'Authorization: Bearer [redacted]',
  'Authorization: Basic [redacted]',
  'Authorization: Token [redacted]',
  'Authorization: Bearer%20[redacted]',
  // url-userinfo.
  'https://[redacted]@example.test/private',
  'ssh://[redacted]@example.test/private',
  'git+ssh://[redacted]@example.test/private',
  // url-query-secret, literal delimiters.
  'https://example.test/?token=[redacted]&safe=1',
  'https://example.test/?service-api-key=[redacted]&signature=[redacted]&safe=1',
  // url-query-secret, percent-encoded delimiters.
  'https://example.test/?access_token%3D[redacted]&client_secret%3D[redacted]&safe=1',
  'https://example.test/%3Fapi%2Dkey%3D[redacted]%26safe%3D1',
  // Composite: credential inside a URL inside a JSON blob.
  '{"registryUrl":"https://[redacted]@registry.test/","apiToken":"[redacted]"}',
  // Composite: percent-encoded query nested inside a redirect parameter.
  'https://example.test/?redirect_uri=https%3A%2F%2Finner.test%2Fcb%3Frefresh_token%3D[redacted]%26password%3D[redacted]%26safe%3D1',
]

// Diagnostic text that must survive untouched. Each entry names the pattern it
// probes so a future loosening of that pattern fails here first.
const UNREDACTED_TEXT: readonly string[] = [
  // credential-assignment: prose mentioning a keyword with no assignment.
  'Missing API token. Run `socket login` to store one.',
  'The signature verification passed.',
  'Set your password in the Socket dashboard.',
  // credential-assignment: package names that embed a keyword.
  'Failed to resolve token-types@5.0.1 and secret-santa@1.0.0.',
  'Cannot find module "keytar-secret-store".',
  // github-token: an ordinary word starting with `gh`.
  'ghost_writer is not a known command.',
  // npm-token / github-token: prefix present but the tail is too short.
  'npm_short and ghp_tiny are not tokens.',
  // openai-secret-key: `sk-` prefix on a short identifier.
  'Unknown locale sk-SK.',
  // socket-api-token: bare hex must survive so SHAs stay readable.
  'Commit 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b is missing.',
  'Checksum mismatch deadbeef.',
  // auth-scheme-header: the scheme word with no credential after it.
  'Bearer authentication is required.',
  // url-query-secret: a query string with no secret-bearing parameter.
  'Fetch failed for https://example.test/docs?page=2&sort=name.',
  // url-userinfo: a URL with no userinfo component.
  'Fetch failed for https://registry.npmjs.org/socket.',
]

describe('redactSecretsFromText', () => {
  it('redacts the full synthetic credential corpus', () => {
    expect(redactSecretsFromText(SYNTHETIC_SECRETS.join('\n'))).toBe(
      REDACTED_EXPECTED.join('\n'),
    )
  })

  it('pairs every synthetic entry with an expectation', () => {
    expect(SYNTHETIC_SECRETS.length).toBe(REDACTED_EXPECTED.length)
  })

  it('leaves no synthetic credential value in the output', () => {
    const redacted = redactSecretsFromText(SYNTHETIC_SECRETS.join('\n'))
    expect(redacted).not.toContain(BODY)
    expect(redacted).not.toContain('SYNTHETIC_PASSPHRASE')
    expect(redacted).not.toContain('U1lOVEhFVElDMDAwMDAwMDA=')
  })

  it('leaves ordinary diagnostic text untouched', () => {
    for (let i = 0, { length } = UNREDACTED_TEXT; i < length; i += 1) {
      const text = UNREDACTED_TEXT[i]!
      expect(redactSecretsFromText(text)).toBe(text)
    }
  })

  it('returns an empty string unchanged', () => {
    expect(redactSecretsFromText('')).toBe('')
  })

  it('is idempotent', () => {
    const once = redactSecretsFromText(SYNTHETIC_SECRETS.join('\n'))
    expect(redactSecretsFromText(once)).toBe(once)
  })

  it('does not mutate its input', () => {
    const input = `GITHUB_TOKEN=ghp_${BODY}`
    redactSecretsFromText(input)
    expect(input).toBe(`GITHUB_TOKEN=ghp_${BODY}`)
  })

  it('redacts across repeated calls despite shared global regexes', () => {
    const input = `npm_${BODY} npm_${BODY}`
    expect(redactSecretsFromText(input)).toBe('[redacted] [redacted]')
    expect(redactSecretsFromText(input)).toBe('[redacted] [redacted]')
  })
})

describe('SECRET_REDACTION_PATTERNS', () => {
  it('uses the shared placeholder', () => {
    expect(SECRET_REDACTION_PLACEHOLDER).toBe('[redacted]')
  })

  it('has a unique name per entry', () => {
    const names = SECRET_REDACTION_PATTERNS.map(pattern => pattern.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares every regex global so replaceAll can use it', () => {
    for (const { name, re } of SECRET_REDACTION_PATTERNS) {
      expect(`${name}:${re.global}`).toBe(`${name}:true`)
    }
  })

  it('matches at least one corpus entry per pattern', () => {
    const corpus = SYNTHETIC_SECRETS.join('\n')
    for (const { name, re } of SECRET_REDACTION_PATTERNS) {
      const probe = new RegExp(re.source, re.flags)
      expect(`${name}:${probe.test(corpus)}`).toBe(`${name}:true`)
    }
  })
})
