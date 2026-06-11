#!/usr/bin/env node
// Claude Code Stop hook — stop-claim-verify-reminder.
//
// Fires at turn-end. Scans the last assistant turn for a SELF-CLAIM that an
// action succeeded — "tests pass", "the build succeeds", "X is fixed",
// "verified" — and checks whether a tool call THIS SESSION actually ran the
// command that would back it. When the claim has no backing tool call, emits a
// stderr reminder: run it, or qualify the claim.
//
// The fleet rule (CLAUDE.md "Judgment & self-evaluation" → "Verify before you
// claim"): never assert "tests pass" / "builds" / "X exists" without a tool call
// this session that ran or read it. This is the verify-before-CLAIM sibling of
// verify-before-TRUST — `excuse-detector` already catches relaying ANOTHER
// agent's unverified count; this catches the assistant's OWN unbacked success
// claim, the failure mode where a turn ends "done, tests pass" with no test run.
//
// Why a reminder, not a block: Stop hooks fire after the turn ended; there is no
// tool call to refuse. The reminder surfaces the unbacked claim at the very turn
// that made it, so the assistant runs the check (or qualifies) next turn.
//
// Categories + their backing-command signals (a claim fires only when NONE of
// its signals appears in any Bash command run this session):
//   - tests   : "tests pass" / "all tests green" → vitest / `pnpm test` / node --test
//   - build   : "the build succeeds" / "builds clean" → `pnpm build` / `run build` / tsgo / rolldown
//   - typecheck: "typechecks" / "no type errors" → tsgo / tsc / `run check`
//   - lint    : "lint passes" / "lint is clean" → oxlint / `run lint` / `run check`
//
// A claim wrapped in a code fence (an example, a quoted plan) is ignored —
// code-fence stripping is always on.
//
// Exit code: 0 always (informational; never blocks). Fail-open on any error.

import process from 'node:process'

import { readLastAssistantText } from '../_shared/transcript.mts'
// Detection (CLAIM_RULES / findUnbackedClaims / sessionBashCommands) is SHARED
// with `unbacked-claim-commit-guard` via `_shared/unbacked-claims.mts` — this
// Stop nudge and that PreToolUse commit/push block read the same matcher.
import {
  findUnbackedClaims,
  sessionBashCommands,
} from '../_shared/unbacked-claims.mts'

interface StopPayload {
  transcript_path?: string | undefined
}

async function drainStdin(): Promise<string> {
  return await new Promise<string>(resolve => {
    let chunks = ''
    process.stdin.on('data', d => {
      chunks += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve(chunks))
    process.stdin.on('error', () => resolve(''))
  })
}

async function main(): Promise<void> {
  let payload: StopPayload
  try {
    payload = JSON.parse(await drainStdin()) as StopPayload
  } catch {
    return
  }
  const text = readLastAssistantText(payload.transcript_path)
  if (!text) {
    return
  }
  const unbacked = findUnbackedClaims(
    text,
    sessionBashCommands(payload.transcript_path),
  )
  if (!unbacked.length) {
    return
  }
  const lines = unbacked.map(u => `  - "${u.label}" — ${u.hint}`)
  process.stderr.write(
    [
      '[stop-claim-verify-reminder] A success claim this turn has no backing tool call this session:',
      ...lines,
      '',
      'Verify before you claim: run the command (and let its output show), or',
      'qualify the statement ("I have not run the tests"). This is the',
      'verify-before-CLAIM sibling of verify-before-trust.',
    ].join('\n'),
  )
}

if (process.argv[1]?.endsWith('index.mts')) {
  await main()
}
