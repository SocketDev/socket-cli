#!/usr/bin/env node
// Claude Code Stop hook — no-orphaned-staging.
//
// Fires at turn-end. Checks `git diff --cached --name-only` in
// $CLAUDE_PROJECT_DIR. If anything is staged but uncommitted, emits
// a stderr warning listing the orphaned paths.
//
// The fleet rule (CLAUDE.md "Don't leave the worktree dirty"):
//
//   Stage only when you're about to commit. `git add` and `git
//   commit` belong on the same line (chained with `&&`) OR in the
//   same Bash call. Don't stage as a side-effect of "preparing"
//   — staging is a commit-time action.
//
// A turn that ends with staged-but-uncommitted hunks tends to be
// either:
//   (a) the agent forgot the commit half of `git add && git commit`,
//   (b) a failed pre-commit hook unstuck the index, or
//   (c) the agent staged "for later" — exactly what this rule
//       forbids.
//
// All three are the same failure mode: the next session sees an
// already-staged index and has to figure out the intent. The
// reminder makes the dangling state visible at the very turn that
// created it.
//
// Why a reminder, not a block: Stop hooks fire AFTER the turn ended;
// there's no tool call to refuse. The signal goes to stderr so the
// next message includes the warning. The agent can then either
// commit or explicitly explain why the staged state is intentional.
//
// Exit codes:
//   0 — always. This is informational; never blocks.
//
// Disabled via `SOCKET_NO_ORPHANED_STAGING_DISABLED=1`.

import { spawnSync } from 'node:child_process'
import process from 'node:process'

function getProjectDir(): string | undefined {
  // Prefer the harness-supplied env (correct even when cwd has been
  // chdir'd by a tool). Fall back to cwd.
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

function listStagedFiles(repoDir: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoDir,
    encoding: 'utf8',
    timeout: 5_000,
  })
  if (r.status !== 0) return []
  return r.stdout.split('\n').map(s => s.trim()).filter(Boolean)
}

async function drainStdin(): Promise<void> {
  // Stop payloads carry transcript_path; this hook doesn't need it,
  // but the stdin must be drained so the harness doesn't pipe-stall.
  await new Promise<void>(resolve => {
    let chunks = ''
    process.stdin.on('data', d => {
      chunks += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    setTimeout(() => resolve(), 200)
    void chunks
  })
}

async function main(): Promise<void> {
  if (process.env['SOCKET_NO_ORPHANED_STAGING_DISABLED']) {
    return
  }
  await drainStdin()

  const repoDir = getProjectDir()
  if (!repoDir) return

  const staged = listStagedFiles(repoDir)
  if (staged.length === 0) return

  process.stderr.write(
    '[no-orphaned-staging] Turn ended with staged-but-uncommitted files:\n',
  )
  for (const f of staged.slice(0, 10)) {
    process.stderr.write(`  - ${f}\n`)
  }
  if (staged.length > 10) {
    process.stderr.write(`  ... and ${staged.length - 10} more\n`)
  }
  process.stderr.write(
    '\nFleet rule: stage only when about to commit. Either:\n' +
      '  • Run `git commit` to finish the work, OR\n' +
      '  • Run `git reset` to unstage (keep changes in working tree).\n' +
      '\nCLAUDE.md → "Don\'t leave the worktree dirty" → "Stage only when ' +
      'you\'re about to commit".\n',
  )
}

main().catch(e => {
  process.stderr.write(
    `[no-orphaned-staging] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
})
