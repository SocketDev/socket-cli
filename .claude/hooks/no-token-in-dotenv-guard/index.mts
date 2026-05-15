#!/usr/bin/env node
// Claude Code PreToolUse hook — no-token-in-dotenv-guard.
//
// Blocks Edit/Write that would put a Socket API token (or any other
// long-lived secret pattern) into a `.env` / `.env.local` / similar
// dotfile. Tokens belong in the OS keychain (macOS Keychain / Linux
// libsecret / Windows CredentialManager — wired via setup-security-
// tools/install.mts) or in CI env, not in files that:
//
//   - Get accidentally committed (despite .gitignore, on dirty repos).
//   - Get read by every dev tool that walks the project dir.
//   - End up in shell-history dotfile dumps.
//   - Get swept by log-scraper / file-indexer tools (Spotlight,
//     Apple Backup, file-sync clients).
//
// Detection:
//
//   - File path ends with `.env`, `.env.local`, `.env.development`,
//     `.env.production`, `.env.<anything>`, `.envrc`, etc.
//   - Content has a line like `<KEY>=<value>` where KEY matches a
//     known token-bearing name (SOCKET_API_TOKEN, SOCKET_API_KEY,
//     SOCKET_CLI_API_TOKEN, SOCKET_SECURITY_API_TOKEN, plus the
//     generic GITHUB_TOKEN / OPENAI_API_KEY / ANTHROPIC_API_KEY
//     patterns — same shape, same leak).
//   - The value is non-empty (a `KEY=` empty placeholder is a
//     template scaffold, not a leak).
//   - The value isn't an obvious placeholder (`<your-token>`,
//     `xxx`, `TODO`, `replace-me`, `${SECRET}`, `$(...)`).
//
// Bypass: `Allow dotenv-token bypass` in a recent user turn. The
// canonical phrase tells the assistant the operator has a specific
// reason (e.g. seeding a test fixture's `.env` with a known-junk
// token that's structurally valid but not authoritative).
//
// Exit codes:
//   0 — pass.
//   2 — block.
//
// Fails open on malformed payloads (exit 0 + stderr log).

import path from 'node:path'
import process from 'node:process'

import {
  GENERIC_TOKEN_SUFFIX_RE,
  isTokenKey,
} from '../_shared/token-patterns.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_input?:
    | {
        readonly content?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
  readonly transcript_path?: string | undefined
}

// Dotfile shapes that carry env-style KEY=VALUE content.
const DOTENV_BASENAME_RE = /^\.env(\..+)?$|^\.envrc$/

// Token-bearing key names live in `_shared/token-patterns.mts` so
// every hook that scans for secret leaks (this one + token-guard)
// shares one catalog. We use both the named-vendor list and the
// generic-suffix fallback here because a dotenv file is the worst
// place for ANY shape of secret — false positives are acceptable.

// Placeholders that mean "the human will fill this in" — these
// don't trip the guard because they're scaffold content, not real
// secrets. Tight whitelist; anything else fires.
const PLACEHOLDER_RE =
  /^(?:|<[^>]+>|x{3,}|TODO|REPLACE[_-]?ME|your[_-]?token|your[_-]?key|\$\{[A-Z_][A-Z0-9_]*\}|\$\([^)]+\))$/i

const BYPASS_PHRASE = 'Allow dotenv-token bypass'

interface Hit {
  readonly line: number
  readonly key: string
  readonly snippet: string
}

function isDotenvPath(filePath: string): boolean {
  return DOTENV_BASENAME_RE.test(path.basename(filePath))
}

/**
 * Match either a known token-bearing vendor key OR a generic
 * `<X>_(?:TOKEN|KEY|SECRET)` suffix. A dotenv is the most leak-prone
 * place a secret can live, so both passes apply here even though
 * elsewhere (token-guard) we prefer the named-vendor list alone.
 */
function isLeakyTokenKey(key: string): boolean {
  return isTokenKey(key) || GENERIC_TOKEN_SUFFIX_RE.test(key)
}

function isPlaceholder(value: string): boolean {
  const stripped = value.replace(/^["']|["']$/g, '').trim()
  return PLACEHOLDER_RE.test(stripped)
}

/**
 * Scan a dotenv body for `<token-key>=<real-value>` patterns. Returns
 * one hit per offending line so the error message can name them all
 * (the operator might have multiple leaks in one paste).
 */
export function findTokenLeaks(content: string): Hit[] {
  const hits: Hit[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) {
      continue
    }
    // Optional `export ` prefix per POSIX shells.
    const rawKey = trimmed.slice(0, eqIdx).trim().replace(/^export\s+/, '')
    if (!isLeakyTokenKey(rawKey)) {
      continue
    }
    const rawValue = trimmed.slice(eqIdx + 1)
    if (isPlaceholder(rawValue)) {
      continue
    }
    hits.push({
      key: rawKey,
      line: i + 1,
      snippet: trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed,
    })
  }
  return hits
}

let payloadRaw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  payloadRaw += chunk
})
process.stdin.on('end', () => {
  try {
    let payload: ToolInput
    try {
      payload = JSON.parse(payloadRaw) as ToolInput
    } catch {
      process.exit(0)
    }
    if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
      process.exit(0)
    }
    const filePath = payload.tool_input?.file_path ?? ''
    if (!filePath || !isDotenvPath(filePath)) {
      process.exit(0)
    }
    const content =
      payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
    if (!content) {
      process.exit(0)
    }
    const hits = findTokenLeaks(content)
    if (hits.length === 0) {
      process.exit(0)
    }
    // Bypass check.
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      process.exit(0)
    }
    const lines: string[] = []
    lines.push('[no-token-in-dotenv-guard] Blocked: token-bearing key in dotenv.')
    lines.push(`  File: ${filePath}`)
    lines.push('')
    for (const h of hits) {
      lines.push(`  Line ${h.line}: ${h.snippet}`)
      lines.push(`    Key:   ${h.key}`)
    }
    lines.push('')
    lines.push('  Dotfiles leak — .env / .env.local accidentally get committed,')
    lines.push('  read by every dev tool that walks the project dir, swept by')
    lines.push("  log-scraper / file-indexer / backup clients. Tokens don't")
    lines.push('  belong here.')
    lines.push('')
    lines.push('  Right places to store a Socket API token:')
    lines.push(
      '    - OS keychain (canonical): run `node .claude/hooks/' +
        'setup-security-tools/install.mts` — it prompts securely and persists',
    )
    lines.push(
      '      to macOS Keychain / Linux libsecret / Windows CredentialManager.',
    )
    lines.push('    - CI env: set as a secret in your CI provider, not in a file.')
    lines.push('')
    lines.push(
      '  Bypass (e.g. seeding a test fixture with a known-junk value):',
    )
    lines.push(`    Type "${BYPASS_PHRASE}" in your next message.`)
    process.stderr.write(lines.join('\n') + '\n')
    process.exit(2)
  } catch (e) {
    process.stderr.write(
      `[no-token-in-dotenv-guard] hook error (allowing): ${e}\n`,
    )
    process.exit(0)
  }
})
