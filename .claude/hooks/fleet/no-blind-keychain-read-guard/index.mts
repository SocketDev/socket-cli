#!/usr/bin/env node
// Claude Code PreToolUse hook — no-blind-keychain-read-guard.
//
// Blocks Bash invocations that READ a credential from the OS
// keychain. Reading via the platform CLI surfaces a per-call UI auth
// prompt on the user's screen ("this app wants to access your
// keychain"), and the prompt fires once per call — a hook chain that
// reads the keychain three times costs three prompts. Tokens are
// already cached in process memory after the first resolution; the
// fleet's canonical resolver (`api-token.mts.findApiToken()`) hits
// the cache, then env, then keychain, in that order. Bash callers
// that go straight to `security find-generic-password` skip all of
// that and re-prompt the user every time.
//
// Detects (case-sensitive, structural — not just substring):
//
//   macOS:
//     security find-generic-password
//     security find-internet-password
//
//   Linux:
//     secret-tool lookup
//     secret-tool search
//
//   Windows (PowerShell):
//     Get-StoredCredential          (CredentialManager module)
//     Get-Credential                (when piping to ConvertFrom-SecureString)
//
//   Cross-platform (Python keyring CLI):
//     keyring get
//
// Allowed (writes / deletes — necessary for operator-driven setup /
// rotation, never on hot paths):
//
//   security add-generic-password   security delete-generic-password
//   secret-tool store               secret-tool clear
//   New-StoredCredential            Remove-StoredCredential
//   keyring set                     keyring del
//
// Bypass: `Allow blind-keychain-read bypass` in a recent user turn.
// Use when you genuinely need to verify a keychain entry exists
// (e.g. operator-invoked diagnostics).
//
// Exit codes:
//   0 — pass.
//   2 — block.
//
// Fails open on malformed payloads (exit 0 + stderr log) — the fleet's
// hook contract.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import { withBashGuard, type ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

interface Hit {
  readonly tool: string
  readonly platform: 'macos' | 'linux' | 'windows' | 'cross-platform'
  readonly snippet: string
}

const BYPASS_PHRASE = 'Allow blind-keychain-read bypass'

// Token-bearing read patterns. Each entry: the literal verb that
// surfaces a UI prompt + a label for the error message. Writes /
// deletes are intentionally absent from this list.
const READ_PATTERNS: ReadonlyArray<{
  readonly re: RegExp
  readonly tool: string
  readonly platform: Hit['platform']
}> = [
  // macOS — `security(1)`. The `-w` flag prints the password to
  // stdout, but even the metadata-only form triggers the ACL prompt.
  {
    re: /\bsecurity\s+(?:find-generic-password|find-internet-password)\b/,
    tool: 'security find-*-password',
    platform: 'macos',
  },
  // Linux — `secret-tool`. `lookup` returns the password; `search`
  // lists matches (also surfaces the libsecret prompt).
  {
    re: /\bsecret-tool\s+(?:lookup|search)\b/,
    tool: 'secret-tool lookup/search',
    platform: 'linux',
  },
  // Windows PowerShell — CredentialManager module. The
  // `Get-StoredCredential` cmdlet returns a PSCredential; reading
  // `.Password | ConvertFrom-SecureString` is the read pattern.
  {
    re: /\bGet-StoredCredential\b/,
    tool: 'Get-StoredCredential',
    platform: 'windows',
  },
  // PowerShell `Get-Credential -Credential` piped to
  // `ConvertFrom-SecureString -AsPlainText` is the readback shape.
  // The bare `Get-Credential` (no pipe) is a fresh-prompt-the-user
  // flow and not the issue here — match only the readback pipe.
  {
    re: /\bGet-Credential\b[^|]*\|\s*ConvertFrom-SecureString\b/,
    tool: 'Get-Credential | ConvertFrom-SecureString',
    platform: 'windows',
  },
  // Python `keyring` CLI — `keyring get <service> <username>`.
  {
    re: /\bkeyring\s+get\b/,
    tool: 'keyring get',
    platform: 'cross-platform',
  },
]

/**
 * Scan a Bash command string for keychain READ patterns. Returns one hit per
 * matching subcommand so the error message can name them all (a `&&`-chained
 * command might have multiple).
 */
export function findKeychainReads(command: string): Hit[] {
  const hits: Hit[] = []
  for (let i = 0, { length } = READ_PATTERNS; i < length; i += 1) {
    const entry = READ_PATTERNS[i]!
    const m = entry.re.exec(command)
    if (!m) {
      continue
    }
    // Pull a short snippet around the match (up to 80 chars) so the
    // operator can see the context. Centered on the match start.
    const start = Math.max(0, m.index - 10)
    const end = Math.min(command.length, m.index + m[0].length + 50)
    const snippet = command.slice(start, end)
    hits.push({
      tool: entry.tool,
      platform: entry.platform,
      snippet: snippet.length < command.length ? `…${snippet}…` : snippet,
    })
  }
  return hits
}

// The block logic. Exits 2 when a keychain read is found without a
// bypass phrase; returns (→ exit 0) otherwise.
function checkCommand(command: string, payload: ToolCallPayload): void {
  const hits = findKeychainReads(command)
  if (hits.length === 0) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }
  const lines: string[] = []
  lines.push(
    '[no-blind-keychain-read-guard] Blocked: direct keychain READ from Bash.',
  )
  lines.push('')
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const h = hits[i]!
    lines.push(`  ${h.platform.padEnd(15)} ${h.tool}`)
    lines.push(`    Saw: ${h.snippet}`)
  }
  lines.push('')
  lines.push('  Reading the keychain via the platform CLI surfaces a UI auth')
  lines.push("  prompt on the user's screen — and the prompt fires once per")
  lines.push('  call. A hook chain that reads three times costs three prompts.')
  lines.push('')
  lines.push('  The token is almost certainly already available without a')
  lines.push('  keychain read:')
  lines.push('')
  lines.push('    - In-process: call findApiToken() from setup-security-tools/')
  lines.push('      lib/api-token.mts. It returns the module-cached value from')
  lines.push('      the first call onward, then env, then keychain.')
  lines.push('')
  lines.push('    - From Bash: read process.env.SOCKET_API_KEY or')
  lines.push(
    '      process.env.SOCKET_API_TOKEN. The wheelhouse shell-rc bridge',
  )
  lines.push('      exports both for every new shell session.')
  lines.push('')
  lines.push('  Writes / deletes (security add-generic-password / secret-tool')
  lines.push('  store / New-StoredCredential / etc.) are allowed — they only')
  lines.push('  happen during operator-driven setup / rotation.')
  lines.push('')
  lines.push('  Bypass (e.g. operator-invoked diagnostics that need a fresh')
  lines.push('  keychain read):')
  lines.push(`    Type "${BYPASS_PHRASE}" in your next message.`)
  logger.error(lines.join('\n') + '\n')
  process.exitCode = 2
}

export { checkCommand }

// CLI entrypoint — only fires when this file is the main module.
// During tests the importer pulls `findKeychainReads` without triggering
// withBashGuard (which would drain stdin and never see an `end` event in
// the test env, hanging the process).
if (process.argv[1]?.endsWith('index.mts')) {
  // withBashGuard handles the stdin drain, tool_name gate, command
  // narrow, and fail-open on any throw.
  await withBashGuard(checkCommand)
}
