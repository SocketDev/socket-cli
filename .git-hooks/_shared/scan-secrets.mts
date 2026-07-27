// Secret / credential + personal-path commit-time scanners, plus the
// API-key allowlist that exempts known-safe matches (public/example/fake
// tokens we deliberately ship). Gate-free string logic built on scan-core.

import { SOCKET_PUBLIC_API_KEY } from '@socketsecurity/lib-stable/constants/socket'

import { scanLines } from './scan-core.mts'
// Personal-path matcher lives in the gate-free _shared/personal-path.mts so the
// edit-time personal-path-guard shares THIS code (was a lock-step inline copy).
import {
  isPurePlaceholder,
  PERSONAL_PATH_RE,
  suggestPlaceholder,
} from './personal-path.mts'

import type { LineHit } from './scan-core.mts'

// ── Allowlist constants ────────────────────────────────────────────
// These exempt known-safe matches from the API-key scanner. Each
// allowlist entry is a substring; if the matched line contains it,
// the line is dropped from the findings.

// Substring marker used in test fixtures (see
// socket-lib/test/unit/utils/fake-tokens.ts). Lines containing this
// are treated as test fixtures.
export const FAKE_TOKEN_MARKER = 'socket-test-fake-token'

// Legacy lib-scoped marker — accepted during the rename from
// `socket-lib-test-fake-token` to `socket-test-fake-token`. Drop when
// lib's rename PR lands.
export const FAKE_TOKEN_LEGACY = 'socket-lib-test-fake-token'

// Env-var name prefixes used in shell examples / `.env.example` files.
// Lines containing `<name>=` are documentation, not real tokens — drop
// them from secret-scanner hits. SOCKET_API_TOKEN is the canonical
// fleet name; the rest are legacy variants kept on the allowlist for
// one cycle so existing `.env.example` files don't trip the gate
// after the rebrand.
export const SOCKET_TOKEN_ENV_NAMES: readonly string[] = [
  'SOCKET_API_TOKEN=',
  'SOCKET_API_KEY=',
  'SOCKET_SECURITY_API_TOKEN=',
  'SOCKET_SECURITY_API_KEY=',
]
// Back-compat alias — earlier callers imported this single-string
// constant. New code should reach for SOCKET_TOKEN_ENV_NAMES.
export const SOCKET_SECURITY_ENV = SOCKET_TOKEN_ENV_NAMES[0]!

// ── API-key allowlist filter ───────────────────────────────────────

// Returns true if a line is on the allowlist (a public/example/fake
// token we deliberately ship). Used by scanners to drop allowlisted
// hits without losing each hit's original lineNumber.
//
// Previous version allowlisted any line containing the bare substring
// '.example' — too broad. Real keys on lines that mention `.example`
// anywhere (TLD, paths, prose like "see .example below") were silently
// allowlisted. Now we require either an explicit per-line marker or
// the canonical fixture filename pattern `.env.example`.
const SOCKET_API_KEY_ALLOW_MARKER = 'socket-lint: allow socket-api-key'
const isAllowedApiKey = (line: string): boolean =>
  line.includes(SOCKET_PUBLIC_API_KEY) ||
  line.includes(FAKE_TOKEN_MARKER) ||
  line.includes(FAKE_TOKEN_LEGACY) ||
  SOCKET_TOKEN_ENV_NAMES.some(name => line.includes(name)) ||
  line.includes(SOCKET_API_KEY_ALLOW_MARKER) ||
  line.includes('.env.example')

// Drops any line that matches an allowlist entry. Kept for callers
// that work on bare lines; new code should filter LineHit[] directly
// via isAllowedApiKey to preserve per-hit lineNumber.
export const filterAllowedApiKeys = (lines: readonly string[]): string[] =>
  lines.filter(line => !isAllowedApiKey(line))

// ── Personal-path scanner ──────────────────────────────────────────
// PERSONAL_PATH_RE / the placeholder filter / suggestPlaceholder are imported
// from _shared/personal-path.mts (the cross-tree canonical home). See that
// module for the leak shapes + allowed-placeholder rationale.

// Returns lines that contain a real personal path (excludes lines that
// are pure placeholders or look like documentation examples). Each hit
// carries a `suggested` rewrite when the scanner can offer one — the
// caller surfaces it to the user as the fix recipe. The regex, the
// pure-placeholder filter, and suggestPlaceholder are imported from the
// shared _shared/personal-path.mts (single source for both hook trees).
export const scanPersonalPaths = (text: string): LineHit[] =>
  scanLines(text, PERSONAL_PATH_RE, {
    // NFKC-normalize before match — catches full-width and ligature
    // variants that would otherwise slip past the ASCII-only regex.
    normalizeForMatch: true,
    // Pure-placeholder lines (no real path remains after stripping every
    // `<...>` placeholder) are documentation, not leaks.
    filter: isPurePlaceholder,
    skipDocs: { rule: 'personal-path' },
    suggest: suggestPlaceholder,
  })

// ── Secret scanners ────────────────────────────────────────────────
//
// These are DELIBERATELY NOT the same as the value-shape catalog in
// .claude/hooks/fleet/_shared/token-patterns.mts (SECRET_VALUE_PATTERNS,
// consumed by secret-content-guard / token-guard). The two serve different
// jobs and must not be merged: the catalog is precise credential VALUE shapes
// (AKIA…, ghp_…) for the edit/Bash guards, where a false positive blocks a
// keystroke; the commit-time scanners below are intentionally BROADER — they
// also flag env-NAME mentions (`aws_access_key`, `aws_secret`) and a loose
// `sktsec_…` of any length, because at commit time a near-miss should still
// surface a leak rather than wave it through. Unifying them would either
// weaken this commit-time net or over-trigger the guards. Keep separate.
const SOCKET_API_KEY_RE = /sktsec_[a-zA-Z0-9_-]+/
// Matches AWS credential env-var names or a classic AKIA access-key ID (16 uppercase alphanumeric chars).
const AWS_KEY_RE = /(?:\bAKIA[0-9A-Z]{16}\b|aws_access_key|aws_secret)/i
// GitHub token formats — accepts both classic opaque and new JWT
// formats per the 2026-05-15 token-format rollout:
//
//   - ghp_ / gho_ / ghr_ / ghu_ / ghs_  : classic opaque 36+ chars
//   - ghs_ + ghu_ (NEW)                  : JWT format, ~520 chars,
//                                          contains two dots and
//                                          underscores. ghu_ scheduled
//                                          for same rollout per
//                                          changelog (timing TBD).
//   - github_pat_                        : fine-grained PAT
//
// The `[A-Za-z0-9._]` char class on ghs_/ghu_ covers BOTH formats
// (classic: alnum only; JWT: alnum + `.` + `_`). Minimum length 36
// is the floor for both formats — classic tokens are 36+ chars after
// the prefix, JWTs are ~520. GitHub's recommended regex is
// `ghs_[A-Za-z0-9\._]{36,}`.
const GITHUB_TOKEN_RE =
  /\b(?:gho_[A-Za-z0-9]{36,}|ghp_[A-Za-z0-9]{36,}|ghr_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9._]{36,}|ghu_[A-Za-z0-9._]{36,}|github_pat_[A-Za-z0-9_]{20,})/
// Private-key PEM headers. Covers every type that wraps a private
// key in PEM armor:
//   - `BEGIN PRIVATE KEY` (PKCS#8, generic)
//   - `BEGIN RSA PRIVATE KEY` (PKCS#1, OpenSSL classic)
//   - `BEGIN EC PRIVATE KEY` / `BEGIN DSA PRIVATE KEY`
//   - `BEGIN OPENSSH PRIVATE KEY` (default ssh-keygen output since 2019;
//     the most common case for personal SSH keys)
//   - `BEGIN ENCRYPTED PRIVATE KEY` (PKCS#8 passphrase-protected)
//   - `BEGIN PGP PRIVATE KEY BLOCK` (PGP secret keys)
// The leading `[A-Z ]*` accepts any uppercase-letters+space prefix
// before "PRIVATE KEY" so future formats are caught automatically.
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/

export const scanSocketApiKeys = (text: string): LineHit[] =>
  scanLines(text, SOCKET_API_KEY_RE, { filter: isAllowedApiKey })

export const scanAwsKeys = (text: string): LineHit[] =>
  scanLines(text, AWS_KEY_RE)

export const scanGitHubTokens = (text: string): LineHit[] =>
  scanLines(text, GITHUB_TOKEN_RE)

export const scanPrivateKeys = (text: string): LineHit[] =>
  scanLines(text, PRIVATE_KEY_RE)
