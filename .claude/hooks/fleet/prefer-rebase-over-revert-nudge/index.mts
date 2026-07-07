#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-rebase-over-revert-nudge.
//
// renamed-from: prefer-rebase-over-revert-guard
//
// Reminder hook (never blocks) that fires when a Bash command runs
// `git revert <ref>` against a ref that's still local-only (not yet
// on origin). For unpushed commits, `git reset --soft HEAD~N` or
// `git rebase -i HEAD~N` cleanly drops the commit; a revert commit
// just pollutes local history with a "Revert ..." noise commit.
//
// For already-pushed commits a revert commit is correct — don't
// rewrite shared history. So the hook only nudges when the target
// is provably unpushed.
//
// Always exits 0 (reminder, not enforcer). Writes the suggestion
// to stderr so the operator sees it before approving the tool call.
//
// Skipped silently:
//   - tool_name !== 'Bash'.
//   - Command doesn't contain `git revert` outside quoted strings.
//   - Command has `--no-edit` or `--no-commit` (advanced workflows).
//   - Target ref can't be parsed (defensive — never false-positive).
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     ... }
//
// Exit codes:
//   0 — always. This is a reminder, not a block.
//
// Fails open on any internal error (exit 0 + stderr log).

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

/**
 * Pull the first argument that looks like a ref out of a `git revert` command.
 * Returns undefined when nothing parsable is found — better to skip the
 * reminder than to false-positive on a complex command.
 *
 * Handles common shapes: git revert HEAD git revert HEAD~3 git revert abc1234
 * git revert <sha>..<sha> git revert --no-commit HEAD.
 */
export function extractRef(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    const revertIdx = c.args.indexOf('revert')
    if (revertIdx === -1) {
      continue
    }
    // First non-flag token after `revert` is the target ref.
    for (let i = revertIdx + 1, { length } = c.args; i < length; i += 1) {
      const tok = c.args[i]!
      if (!tok.startsWith('-') && tok.length > 0) {
        return tok
      }
    }
  }
  return undefined
}

function isGitRevert(command: string): boolean {
  return commandsFor(command, 'git').some(c => c.args.includes('revert'))
}

/**
 * Probe `git` for whether `ref` is reachable on `origin/<current-branch>`. If
 * the local branch has no upstream we can't tell, so return undefined (= "don't
 * fire the reminder, we'd false-positive on a brand-new branch").
 */
export function isRefPushed(ref: string): boolean | undefined {
  // Run all probes in the current working directory — same dir the
  // user's `git revert` would run in.
  const opts = { encoding: 'utf8' as const, stdio: 'pipe' as const }

  // 1. Resolve the symbolic upstream. Empty = no upstream (new branch).
  const upstream = spawnSync(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    opts,
  )
  if (upstream.status !== 0) {
    return undefined
  }
  const upstreamRef = String(upstream.stdout).trim()
  /* c8 ignore start - git outputs a non-empty ref when status is 0; empty string is unreachable via real git */
  if (!upstreamRef) {
    return undefined
  }
  /* c8 ignore stop */

  // 2. Resolve the target ref to a SHA. Bad refs → undefined.
  const targetSha = spawnSync(
    'git',
    ['rev-parse', '--verify', `${ref}^{commit}`],
    opts,
  )
  if (targetSha.status !== 0) {
    return undefined
  }
  const sha = String(targetSha.stdout).trim()
  /* c8 ignore start - git outputs a non-empty SHA when status is 0; empty string is unreachable via real git */
  if (!sha) {
    return undefined
  }
  /* c8 ignore stop */

  // 3. Is the SHA an ancestor of the upstream branch?
  // `git merge-base --is-ancestor` exits 0 if yes, 1 if no.
  const isAncestor = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', sha, upstreamRef],
    opts,
  )
  if (isAncestor.status === 0) {
    return true
  }
  /* c8 ignore start - merge-base exits only 0 or 1 under normal git; status ≠ 1 here requires corrupted refs */
  if (isAncestor.status === 1) {
    return false
  }
  return undefined
  /* c8 ignore stop */
}

export const check = bashGuard(command => {
  // Only fire on real `git revert` invocations (parser sees through
  // chains / `$(…)`; a quoted "git revert" in a message is ignored).
  if (!isGitRevert(command)) {
    return undefined
  }

  // Skip advanced workflows. `--no-commit` / `--no-edit` mean the
  // operator is mid-merge or scripting; the rebase suggestion
  // doesn't apply cleanly.
  if (/--no-(?:commit|edit)\b/.test(command)) {
    return undefined
  }

  const ref = extractRef(command)
  if (!ref) {
    return undefined
  }

  const pushed = isRefPushed(ref)
  if (pushed !== false) {
    // Pushed (= revert is correct), or unknowable (= don't false-
    // positive on a brand-new branch with no upstream).
    return undefined
  }

  return notify(
    [
      '[prefer-rebase-over-revert-nudge] Reminder: this commit looks unpushed.',
      '',
      `  Target ref:  ${ref}`,
      '',
      '  For unpushed commits, `git reset --soft HEAD~N` (or `git rebase -i HEAD~N`)',
      '  cleanly drops the commit — no "Revert ..." noise in history. Revert commits',
      '  are correct for changes already on origin.',
      '',
      '  Proceed if intentional; this is a reminder, not a block.',
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

void runHook(hook, import.meta.url)
