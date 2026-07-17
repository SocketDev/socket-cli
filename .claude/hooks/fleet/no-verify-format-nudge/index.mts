#!/usr/bin/env node
// Claude Code PreToolUse hook — no-verify-format-nudge.
//
// `git commit/push --no-verify` skips the WHOLE pre-commit/pre-push chain —
// including the oxfmt FORMAT gate, not just the test/lint steps. Reaching for
// --no-verify to get past a HANGING pre-commit (the common reason) therefore
// silently ships unformatted files, which then fail CI's format check. This
// hook runs `oxfmt --check` on the changed format-relevant files the moment a
// --no-verify commit/push is about to run, and warns about any that aren't
// clean, naming the exact fix.
//
// REMINDER (exit 0 + stderr), never a block: --no-verify is legitimate (a
// genuinely broken/hanging pre-commit) and is already gated behind the
// `Allow no-verify bypass` phrase by no-revert-guard. This hook only adds the
// "and don't forget the format gate you just skipped" nudge so the debt gets
// fixed (oxfmt + amend) before it reaches CI.
//
// Complements pre-commit-race-nudge (which steers away from --no-verify for
// an index RACE); this one is specifically about the skipped FORMAT gate.
//
// Fires on Bash `git commit/push ... --no-verify` (or `-n`). Silent for
// FLEET_SYNC=1 cascade commits (the documented --no-verify exception).
// Fail-open: any error (no git, no oxfmt, spawn failure) exits 0 silently — a
// reminder must never block a commit on its own bug.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { gitSubcommand } from '../_shared/commit-command.mts'
import { actedOnPath } from '../_shared/fleet-context.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import {
  commandsFor,
  invocationHasFlag,
  isFleetSyncCommand,
} from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

const NO_VERIFY_FLAGS = ['--no-verify', '-n']
// Files oxfmt formats — the gate that --no-verify skipped. Lockfiles, JSON
// config, assets, markdown-without-prose etc. aren't oxfmt's surface.
export const FORMATTABLE_RE = /\.(?:c|m)?[jt]sx?$/

export function isGitCommitOrPush(command: string): boolean {
  // Parser-backed subcommand read (never a raw regex over the command
  // string): a quoted "git commit" literal inside another command's string
  // argument is not an invocation, and `git config commit.gpgsign` /
  // `git -c k=v commit` resolve to their real subcommands.
  return commandsFor(command, 'git').some(c => {
    const sub = gitSubcommand(c)
    return sub === 'commit' || sub === 'push'
  })
}

function gitLines(cwd: string, args: readonly string[]): string[] {
  const r = spawnSync('git', args, { cwd, timeout: spawnTimeoutMs(5000) })
  if (r.status !== 0) {
    return []
  }
  return String(r.stdout)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

// The changed format-relevant files for the about-to-run commit: staged
// (`--cached`) plus unstaged working-tree changes, deduped. push has no staged
// set, so fall back to the diff against the upstream/HEAD~ — but for the common
// commit case staged+unstaged is what's shipping.
function changedFormattableFiles(cwd: string): string[] {
  const staged = gitLines(cwd, ['diff', '--name-only', '--cached'])
  const unstaged = gitLines(cwd, ['diff', '--name-only'])
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of [...staged, ...unstaged]) {
    if (FORMATTABLE_RE.test(f) && !seen.has(f)) {
      seen.add(f)
      out.push(f)
    }
  }
  return out
}

function unformatted(cwd: string, files: readonly string[]): string[] {
  if (files.length === 0) {
    return []
  }
  // Run per-file so one parse error doesn't mask the rest and so the report
  // names exactly which files need formatting. A mis-formatted file makes
  // oxfmt exit non-zero AND print "Format issues found" to stdout. Require
  // BOTH signals before flagging: a non-zero exit with no such output is an
  // oxfmt error (bad/missing config, the binary not resolving in this cwd), so
  // fail OPEN — a reminder must never invent format debt from its own breakage.
  const bad: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    const r = spawnSync(
      'node_modules/.bin/oxfmt',
      ['-c', '.config/fleet/oxfmtrc.json', '--check', f],
      { cwd, timeout: 20_000 },
    )
    const out = `${String(r.stdout ?? '')}${String(r.stderr ?? '')}`
    if (r.status !== 0 && /Format issues found/.test(out)) {
      bad.push(f)
    }
  }
  return bad
}

export const check = bashGuard((command, payload) => {
  if (isFleetSyncCommand(command)) {
    return undefined
  }
  if (!isGitCommitOrPush(command)) {
    return undefined
  }
  if (!invocationHasFlag(command, 'git', NO_VERIFY_FLAGS)) {
    return undefined
  }
  // The repo the commit/push ACTS on — a `cd <sibling> && git commit
  // --no-verify` must be format-checked against that repo's tree, not the
  // session repo's.
  const cwd = actedOnPath(payload)
  const files = changedFormattableFiles(cwd)
  const bad = unformatted(cwd, files)
  if (bad.length === 0) {
    return undefined
  }
  return notify(
    [
      `[no-verify-format-nudge] --no-verify skips the FORMAT gate too — ${bad.length} ` +
        `changed file(s) are unformatted and will fail CI's format check:`,
      ...bad.slice(0, 10).map(f => `  ${f}`),
      ...(bad.length > 10 ? [`  … and ${bad.length - 10} more`] : []),
      '',
      'Format them, then amend (the commit already ran un-gated):',
      `  node_modules/.bin/oxfmt -c .config/fleet/oxfmtrc.json ${bad.slice(0, 3).join(' ')}${bad.length > 3 ? ' …' : ''}`,
      '  git add <files> && git commit --amend --no-edit --no-verify',
      '',
      'oxfmt reflows long signatures + JSDoc; if it mangles an aligned',
      'code/YAML block inside a `*` comment into run-on prose, rewrite that',
      'comment as flat prose so oxfmt leaves it stable.',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})

/* c8 ignore start - standalone entrypoint, not reachable when imported by tests */
void runHook(hook, import.meta.url)
/* c8 ignore stop */
