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
// Verdict (uniform guard contract): `check` returns `block(message)` to block
// (the runner prints the message + sets exitCode 2) or `undefined` to allow.
// `runGuard` fails open on malformed payloads — the fleet's hook contract.

import { block, defineHook, runHook } from '../_shared/guard.mts'
import { readCommand } from '../_shared/payload.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

interface Hit {
  readonly tool: string
  readonly platform: 'macos' | 'linux' | 'windows' | 'cross-platform'
  readonly snippet: string
}

const BYPASS_PHRASE = 'Allow blind-keychain-read bypass'

// Pre-flight triggers — the dispatcher imports + runs this guard only
// when the raw command contains at least one of these substrings. Each
// is the literal anchor a `READ_PATTERNS` entry requires, so no command
// can match a pattern without containing one of them: `find-*-password`
// (macOS `security`), `secret-tool` (Linux), `Get-StoredCredential` and
// `ConvertFrom-SecureString` (Windows readback pipe), `keyring` (Python
// CLI). Writes/deletes share these substrings too, so the guard still
// runs for them and correctly returns no hit.
export const triggers: readonly string[] = [
  'ConvertFrom-SecureString',
  'Get-StoredCredential',
  'find-generic-password',
  'find-internet-password',
  'keyring',
  'secret-tool',
]

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

/**
 * Pure detection. Returns the exact block message when the payload is a Bash
 * call whose command reads the keychain; `undefined` otherwise (non-Bash tool,
 * absent command, or no keychain read). The internal `typeof === 'string'`
 * narrow in `readCommand` keeps the `unknown` payload fields safe.
 */
export function keychainReadMessage(
  payload: ToolCallPayload,
): string | undefined {
  if (payload?.tool_name !== 'Bash') {
    return undefined
  }
  const command = readCommand(payload)
  if (!command) {
    return undefined
  }
  const hits = findKeychainReads(command)
  if (hits.length === 0) {
    return undefined
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
  return lines.join('\n') + '\n'
}

// The block logic. Blocks when a keychain read is found without a
// bypass phrase; allows (returns undefined) otherwise.
export const check = (payload: ToolCallPayload) => {
  const message = keychainReadMessage(payload)
  if (!message) {
    return undefined
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }
  return block(message)
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
