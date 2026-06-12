#!/usr/bin/env node
// Claude Code PreToolUse hook — brew-supply-chain-guard.
//
// BLOCKS a Bash command that invokes `brew` when this machine's Homebrew is not
// hardened to the 6.0.0 supply-chain posture: either the installed Homebrew is
// below 6.0.0, or HOMEBREW_REQUIRE_TAP_TRUST / HOMEBREW_CASK_OPTS_REQUIRE_SHA
// is unset.
//
// Why (https://brew.sh/2026/06/11/homebrew-6.0.0/): 6.0.0 added tap trust
// (refuse untrusted third-party tap code) + cask checksum enforcement (refuse a
// `sha256 :no_check` download). Both env knobs are silently ignored by an older
// brew, so a version floor is the only real enforcement. This is a distinct
// concern from package-manager-auto-update-guard (HOMEBREW_NO_AUTO_UPDATE);
// both read brew but for different reasons, so they're separate single-purpose
// guards. All detection lives in _shared/brew-supply-chain.mts (code is law,
// DRY) — shared with the check --all audit + setup-security-tools.
//
// A machine without brew on PATH (`absent`) passes — not applicable (CI
// runners legitimately lack brew).
//
// Bypass: `Allow brew-supply-chain bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / payload errors (exit 0) — a guard bug must not wedge
// every Bash call.

import process from 'node:process'

import {
  BREW_MIN_VERSION,
  BREW_SUPPLY_CHAIN_BYPASS_PHRASE,
  commandInvokesBrew,
  detectBrewSecurity,
} from '../_shared/brew-supply-chain.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface Payload {
  tool_name?: unknown | undefined
  tool_input?: { command?: unknown | undefined } | undefined
  transcript_path?: unknown | undefined
}

export function formatBlock(reason: string): string {
  return (
    [
      `[brew-supply-chain-guard] Blocked: Homebrew is not hardened to the ${BREW_MIN_VERSION} supply-chain posture.`,
      '',
      `  ${reason}`,
      '',
      '  Homebrew 6.0.0 adds tap trust + cask checksum enforcement. An older',
      '  brew ignores the env knobs, so the version floor is the gate. Fix:',
      '',
      '    • upgrade:  brew update && brew upgrade   (to >= 6.0.0)',
      '    • harden:   node .claude/hooks/fleet/setup-security-tools/install.mts',
      '                (sets HOMEBREW_REQUIRE_TAP_TRUST + HOMEBREW_CASK_OPTS_REQUIRE_SHA)',
      '',
      `  Bypass: type "${BREW_SUPPLY_CHAIN_BYPASS_PHRASE}" to allow it for this invocation.`,
    ].join('\n') + '\n'
  )
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }

  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }

  const command =
    typeof payload.tool_input?.command === 'string'
      ? payload.tool_input.command
      : ''
  if (!command.trim() || !commandInvokesBrew(command)) {
    process.exit(0)
  }

  const status = detectBrewSecurity()
  if (status.state !== 'unhardened') {
    // 'hardened' (good) or 'absent' (not applicable) — allow.
    process.exit(0)
  }

  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BREW_SUPPLY_CHAIN_BYPASS_PHRASE], 8)
  ) {
    process.exit(0)
  }

  process.stderr.write(formatBlock(status.reason))
  process.exit(2)
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when a test
// imports this module for its pure helpers (else main() blocks on stdin at
// import and the test file never terminates).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
