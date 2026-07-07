#!/usr/bin/env node
// Claude Code PreToolUse hook — unbacked-claim-commit-guard.
//
// BLOCKS (exit 2) a `git commit` / `git push` when the LAST assistant turn made
// a success self-claim — "tests pass", "the build succeeds", "typechecks", "lint
// passes", "render verified" — that NO Bash command this session backs.
//
// The fleet rule (CLAUDE.md "Judgment & self-evaluation" → "Verify before you
// claim"): never assert a check passed without a tool call this session that ran
// it. The Stop-time `stop-claim-verify-reminder` nudges at turn-end; this is the
// hard half — it stops the unverified claim from LANDING in a commit/push.
//
// DRY: detection (findUnbackedClaims / sessionBashCommands / CLAIM_RULES) is the
// SAME `_shared/unbacked-claims.mts` matcher the Stop reminder uses. One matcher,
// two enforcement points — they never drift.
//
// Bypass: `Allow unbacked-claim bypass` in a recent user turn (for the case
// where the claim is true but verified outside this session, or is fine to land).
//
// Exit codes:
//   2 — commit/push with an unbacked claim in the last turn (blocked).
//   0 — otherwise, or on any error (fail-open).

import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readLastAssistantText } from '../_shared/transcript.mts'
import {
  findUnbackedClaims,
  sessionBashCommands,
} from '../_shared/unbacked-claims.mts'

const BYPASS_PHRASE = 'Allow unbacked-claim bypass'

// True when the command lands work — git commit or git push. Pull/fetch/status
// don't land anything, so an unverified claim sitting next to them is harmless.
export function isLandingCommand(command: string): boolean {
  return (
    findInvocation(command, { binary: 'git', subcommand: 'commit' }) ||
    findInvocation(command, { binary: 'git', subcommand: 'push' })
  )
}

async function main(): Promise<void> {
  await withBashGuard((command, payload) => {
    if (!isLandingCommand(command)) {
      return
    }
    const transcriptPath = payload.transcript_path
    const text = readLastAssistantText(transcriptPath)
    if (!text) {
      return
    }
    const unbacked = findUnbackedClaims(text, sessionBashCommands(transcriptPath))
    if (!unbacked.length) {
      return
    }
    if (bypassPhrasePresent(transcriptPath, BYPASS_PHRASE)) {
      return
    }
    const lines = [
      '[unbacked-claim-commit-guard] Blocked: landing a commit/push with an',
      'unverified success claim in this turn:',
      '',
    ]
    for (let i = 0, { length } = unbacked; i < length; i += 1) {
      const u = unbacked[i]!
      lines.push(`  • "${u.label}" — ${u.hint}`)
    }
    lines.push('')
    lines.push('  Run the command that backs the claim (and let its output show)')
    lines.push('  before committing, or qualify the statement. Verify before you')
    lines.push('  claim — and before you land.')
    lines.push('')
    lines.push(`  Bypass: type "${BYPASS_PHRASE}" in a recent message.`)
    process.stderr.write(lines.join('\n') + '\n')
    process.exitCode = 2
  })
}

if (process.argv[1]?.endsWith('index.mts')) {
  await main()
}
