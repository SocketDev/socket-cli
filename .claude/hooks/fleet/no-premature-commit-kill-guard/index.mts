#!/usr/bin/env node
// Claude Code PreToolUse hook — no-premature-commit-kill-guard.
//
// Three Bash anti-patterns, one theme — a git/test op wedged or torn down in a
// context that can't finish it. A `git commit` (and rebase/merge/cherry-pick,
// which also fire the pre-commit chain) runs the staged-test reminder, which is
// BOUNDED to ~60s (STAGED_TEST_TIMEOUT_MS) but still takes real time. A commit
// that is "still running" before that elapses is NOT a hang.
//
//   1. Backgrounding it (`run_in_background: true`) hides the bounded run's
//      completion, so the operator checks too early, sees it "still going",
//      and concludes it hung.
//   2. Then `pkill`/`kill` of the git op (or the vitest it spawned) tears down
//      a mid-hook run — which corrupts the index (a half-written
//      `.git/index.lock`) and leaks vitest worker processes. A `git push` has
//      the same shape (its pre-push gate is also bounded), and a BROAD kill
//      pattern (bare `git push` / `pre-push`) matches the same op in every
//      sibling checkout — so it can reap a PARALLEL session's git op in
//      another repo.
//   3. `agent-ci run … --pause-on-failure` (the `ci:local` shape) holds the run
//      at the first failing step for an interactive keypress. A non-interactive
//      agent can never answer it, so the run parks forever AND pins the
//      worktree's `.git/index.lock`, wedging every concurrent `git commit` in
//      that checkout. Independent of run_in_background (the harness may
//      auto-background a slow foreground commit), so matched on command shape.
//
// Both are blocked here so the loop can't start: run git ops in the FOREGROUND
// and WAIT for the bounded hook; never kill one mid-flight. When a kill is
// genuinely needed, scope it to a repo path + verify the PID's cwd.
//
// Detection (AST-parsed via _shared/shell-command.mts, never raw regex on the
// line — args are inspected only after parseCommands extracts them):
//   - run_in_background === true AND the command invokes
//     `git <commit|rebase|merge|cherry-pick>`.
//   - a `pkill`/`kill`/`killall` whose args reference `git commit`/`git push`,
//     a `pre-commit`/`pre-push` hook process, or a bare `vitest` run. The
//     worker-scoped reap `vitest/dist/workers` is EXEMPT — it is the
//     documented orphan-recovery, not a teardown of a live run.
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

const GIT_PRE_COMMIT_SUBCOMMANDS = ['commit', 'rebase', 'merge', 'cherry-pick']

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

// True when the command runs agent-ci with `--pause-on-failure` (the canonical
// `ci:local` shape, directly or via the `agent-ci-skip-locks.mts run` wrapper).
// That flag holds the container at the first failing step waiting for an
// interactive keypress. The agent is non-interactive — it can never answer the
// pause — so the run parks indefinitely, and because agent-ci stages into the
// worktree it pins the worktree's `.git/index.lock`, wedging every concurrent
// `git commit` in that checkout (observed: a backgrounded relock commit parked
// ~5h behind a paused `ci:local`). `ci:local` is for a human at a terminal; an
// agent must run the non-pausing CI path instead.
export function invokesPausingCi(command: string): string | undefined {
  // agent-ci can be invoked directly (`agent-ci run …`) or through the
  // fleet wrapper (`node scripts/fleet/agent-ci-skip-locks.mts run …`).
  const hit =
    findInvocation(command, { binary: 'agent-ci', subcommand: 'run' }) ||
    commandsFor(command, 'node').some(c =>
      c.args.some(a => a.includes('agent-ci-skip-locks.mts')),
    )
  if (!hit) {
    return undefined
  }
  // Only the pausing form is the trap — a plain `agent-ci run` (CI / --quiet)
  // exits on failure and is fine. Inspect the already-extracted command text.
  return command.includes('--pause-on-failure')
    ? 'agent-ci run --pause-on-failure'
    : undefined
}

// True when the command is a process-kill (`pkill`/`kill`/`killall`) whose
// args target an in-flight git op or its test run — the premature-teardown
// shape. Matches:
//   - `vitest` (the test run a pre-commit/pre-push spawned)
//   - `git commit` / `git push` (the op whose hook chain is mid-run; killing a
//     push mid-flight also disrupts a PARALLEL session's push)
//   - the hook process names `pre-commit` / `pre-push` (a `pkill -f
//     "…/pre-push"` targets the gate directly)
// `kill <pid>` of an unrelated process is NOT matched (no git/test token).
//
// One exemption: `vitest/dist/workers` is the blessed orphan-reap (the
// stale-process-sweeper's own target, documented in CLAUDE.md). A kill pattern
// scoped to the worker path is a deliberate reap of a CONFIRMED-dead worker,
// not a teardown of a live run — let it through so the documented recovery
// (`pkill -f "vitest/dist/workers"`) is not itself blocked.
//
// Why also catch the bare/unscoped shapes: a pattern like `pkill -f "git push"`
// or `pkill -f pre-push` matches the SAME op in every sibling checkout, so it
// reaps a parallel/Codex session's in-flight op in another repo. The teardown
// is the danger whether the target is yours or a neighbor's — block it and
// point the operator at a repo-path-qualified, cwd-verified kill instead.
// The blessed reap (`pkill -f "vitest/dist/workers"`) is the one correct kill
// shape — match it as a plain substring so it is exempted first.
const BLESSED_REAP = 'vitest/dist/workers'
export function killsGitOpOrTestRun(command: string): string | undefined {
  for (const bin of ['pkill', 'killall', 'kill']) {
    const cmds = commandsFor(command, bin)
    for (let i = 0, { length } = cmds; i < length; i += 1) {
      // The kill TARGET is the `-f`/`-9` pattern string the user passes to
      // pkill — a literal search pattern, not a parseable command. Plain
      // substring tests are the right tool (and stay clear of the
      // command-regex-in-hooks reminder); commandsFor already AST-extracted
      // the kill invocation, this only inspects its argument text.
      const joined = cmds[i]!.args.join(' ')
      if (joined.includes(BLESSED_REAP)) {
        continue
      }
      if (joined.includes('vitest')) {
        return `${bin} … vitest`
      }
      if (joined.includes('git push')) {
        return `${bin} … git push`
      }
      if (joined.includes('git commit')) {
        return `${bin} … git commit`
      }
      if (joined.includes('pre-push')) {
        return `${bin} … pre-push`
      }
      if (joined.includes('pre-commit')) {
        return `${bin} … pre-commit`
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
      '  Killing a git commit/push or its vitest mid-hook corrupts the index',
      '  (stale .git/index.lock) and leaks vitest worker processes. The',
      '  pre-commit/pre-push staged-test reminder is bounded to ~60s — WAIT.',
      '',
      '  A broad pattern (bare `git push` / `pre-push`) also matches the SAME op',
      "  in every sibling checkout — so this can reap a PARALLEL session's git",
      '  op in another repo. If you must stop one, scope the pattern to a full',
      '  repo path (`pkill -f "<repo>/.git-hooks/.../pre-push"`) and verify the',
      "  PID's cwd first (`lsof -a -p <pid> -d cwd -Fn`).",
      '',
      '  If a run is genuinely dead (confirmed, not just slow), reap the orphan',
      '  with `pkill -f "vitest/dist/workers"` after the op has exited (that',
      `  worker-scoped pattern is allowed), or type "${BYPASS_PHRASE}".`,
    ].join('\n') + '\n',
  )
}

function emitPausingCiBlock(label: string): void {
  process.stderr.write(
    [
      `[no-premature-commit-kill-guard] Blocked: \`${label}\`.`,
      '',
      '  `--pause-on-failure` holds agent-ci at the first failing step waiting',
      '  for an interactive keypress. This session is non-interactive — it can',
      '  never answer the pause, so the run parks forever. Worse, agent-ci stages',
      '  into the worktree and pins `.git/index.lock`, so every concurrent',
      '  `git commit` in this checkout wedges behind it.',
      '',
      '  Run the non-pausing CI path instead: drop `--pause-on-failure` (plain',
      '  `agent-ci run --all --quiet` exits on failure and prints the log), or',
      '  use the `/fleet:green-ci-local` skill which drives agent-ci and fixes',
      '  the first failure programmatically.',
      '',
      `  Bypass (only if a human is at this terminal): type "${BYPASS_PHRASE}".`,
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
  const killTarget = killsGitOpOrTestRun(command)
  // The pausing-CI trap is independent of run_in_background: the harness may
  // auto-background a slow foreground command, so the field can't be relied on.
  // Match the command shape directly.
  const pausingCi = invokesPausingCi(command)

  if (!bgGit && !killTarget && !pausingCi) {
    process.exit(0)
  }

  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  // Wider lookback than the fleet default (3): unsticking a hung/dead commit is
  // inherently a multi-turn diagnosis (confirm the proc is dead, check the lock,
  // try a reap), so the user's bypass phrase routinely ages past a 3-turn window
  // before the kill command re-fires. 8 turns keeps the granted bypass live
  // through that back-and-forth.
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 8)
  ) {
    process.exit(0)
  }

  if (bgGit) {
    emitBackgroundBlock(bgGit)
  } else if (killTarget) {
    emitKillBlock(killTarget)
  } else if (pausingCi) {
    emitPausingCiBlock(pausingCi)
  }
  process.exit(2)
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// imports this module for its pure helpers (else main() blocks on stdin at
// import and the test file never terminates).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
