#!/usr/bin/env node
// Claude Code PreToolUse hook — no-premature-commit-kill-guard.
//
// Two Bash anti-patterns, one root cause: a `git commit` (and rebase/merge/
// cherry-pick, which also fire the pre-commit chain) runs the staged-test
// reminder, which is BOUNDED to ~60s (STAGED_TEST_TIMEOUT_MS) but still takes
// real time. A commit that is "still running" before that elapses is NOT a
// hang.
//
//   1. Backgrounding it (`run_in_background: true`) hides the bounded run's
//      completion, so the operator checks too early, sees it "still going",
//      and concludes it hung.
//   2. Then `pkill`/`kill` of the git-commit (or the vitest it spawned) tears
//      down a mid-pre-commit run — which corrupts the index (a half-written
//      `.git/index.lock`) and leaks vitest worker processes.
//
// Both are blocked here so the loop can't start: run commits in the FOREGROUND
// and WAIT for the bounded pre-commit; never kill one mid-flight.
//
// Detection (AST-parsed via _shared/shell-command.mts, never raw regex on the
// line):
//   - run_in_background === true AND the command invokes
//     `git <commit|rebase|merge|cherry-pick>`.
//   - a `pkill`/`kill`/`killall` whose args reference a `git commit` or
//     `vitest` target.
//
// Bypass: `Allow background-git bypass` typed verbatim in a recent user turn
// (e.g. a genuinely long migration commit you'll babysit out-of-band, or
// reaping a confirmed-dead leaked vitest).
//
// Fails open on parse / payload errors.

import process from 'node:process'

import { commandsFor, findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow background-git bypass'

const GIT_PRE_COMMIT_SUBCOMMANDS = [
  'commit',
  'rebase',
  'merge',
  'cherry-pick',
]

interface Payload {
  tool_name?: unknown | undefined
  tool_input?:
    | { command?: unknown | undefined; run_in_background?: unknown | undefined }
    | undefined
  transcript_path?: unknown | undefined
}

// True when the command invokes a git subcommand that triggers the pre-commit
// chain (and thus the bounded staged-test reminder).
export function invokesPreCommitGit(command: string): string | undefined {
  for (let i = 0, { length } = GIT_PRE_COMMIT_SUBCOMMANDS; i < length; i += 1) {
    const sub = GIT_PRE_COMMIT_SUBCOMMANDS[i]!
    if (findInvocation(command, { binary: 'git', subcommand: sub })) {
      return `git ${sub}`
    }
  }
  return undefined
}

// True when the command is a process-kill (`pkill`/`kill`/`killall`) whose
// args target a `git commit` or a `vitest` run — the premature-teardown shape.
// `kill <pid>` of an unrelated process is NOT matched (no git/vitest token).
export function killsCommitOrVitest(command: string): string | undefined {
  for (const bin of ['pkill', 'killall', 'kill']) {
    const cmds = commandsFor(command, bin)
    for (let i = 0, { length } = cmds; i < length; i += 1) {
      const joined = cmds[i]!.args.join(' ')
      if (/\bvitest\b/.test(joined)) {
        return `${bin} … vitest`
      }
      if (/git\s+commit\b/.test(joined)) {
        return `${bin} … git commit`
      }
    }
  }
  return undefined
}

function emitBackgroundBlock(label: string): void {
  process.stderr.write(
    [
      `[no-premature-commit-kill-guard] Blocked: backgrounding \`${label}\`.`,
      '',
      `  A ${label} fires the pre-commit chain, whose staged-test reminder is`,
      '  BOUNDED to ~60s (STAGED_TEST_TIMEOUT_MS) but still takes real time. Run',
      '  in the FOREGROUND and wait — a still-running commit is not a hang.',
      '  Backgrounding hides its completion and invites a premature kill that',
      '  corrupts the index + leaks vitest workers.',
      '',
      `  Bypass (rare; you'll babysit it): type "${BYPASS_PHRASE}".`,
    ].join('\n') + '\n',
  )
}

function emitKillBlock(label: string): void {
  process.stderr.write(
    [
      `[no-premature-commit-kill-guard] Blocked: \`${label}\`.`,
      '',
      '  Killing a git-commit or its vitest mid-pre-commit corrupts the index',
      '  (stale .git/index.lock) and leaks vitest worker processes. The',
      '  pre-commit staged-test reminder is bounded to ~60s — WAIT for it.',
      '',
      '  If a run is genuinely dead (confirmed, not just slow), reap the orphan',
      '  with `pkill -f "vitest/dist/workers"` after the commit has exited, or',
      `  type "${BYPASS_PHRASE}" to allow this kill.`,
    ].join('\n') + '\n',
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
  if (!command.trim()) {
    process.exit(0)
  }

  const backgrounded = payload.tool_input?.run_in_background === true
  const bgGit = backgrounded ? invokesPreCommitGit(command) : undefined
  const killTarget = killsCommitOrVitest(command)

  if (!bgGit && !killTarget) {
    process.exit(0)
  }

  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (transcriptPath && bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 3)) {
    process.exit(0)
  }

  if (bgGit) {
    emitBackgroundBlock(bgGit)
  } else if (killTarget) {
    emitKillBlock(killTarget)
  }
  process.exit(2)
}

void main()
