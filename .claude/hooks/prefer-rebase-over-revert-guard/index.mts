#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-rebase-over-revert-guard.
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

import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { containsOutsideQuotes } from '../_shared/bash-quote-mask.mts'

interface ToolInput {
  readonly tool_input?: { readonly command?: string } | undefined
  readonly tool_name?: string | undefined
}

/**
 * Pull the first argument that looks like a ref out of a `git revert`
 * command. Returns undefined when nothing parsable is found — better
 * to skip the reminder than to false-positive on a complex command.
 *
 * Handles common shapes:
 *   git revert HEAD
 *   git revert HEAD~3
 *   git revert abc1234
 *   git revert <sha>..<sha>
 *   git revert --no-commit HEAD
 */
function extractRef(command: string): string | undefined {
  const m = command.match(/\bgit\s+revert\s+([^\s;&|`]+(?:\s+[^\s;&|`-][^\s;&|`]*)?)/)
  if (!m) {
    return undefined
  }
  // The capture may include subsequent non-flag tokens for ranges
  // like `<sha>..<sha>`. Take the first whitespace-delimited token
  // that isn't a flag.
  for (const tok of m[1]!.split(/\s+/)) {
    if (!tok.startsWith('-') && tok.length > 0) {
      return tok
    }
  }
  return undefined
}

/**
 * Probe `git` for whether `ref` is reachable on `origin/<current-branch>`.
 * If the local branch has no upstream we can't tell, so return undefined
 * (= "don't fire the reminder, we'd false-positive on a brand-new branch").
 */
function isRefPushed(ref: string): boolean | undefined {
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
  const upstreamRef = upstream.stdout.trim()
  if (!upstreamRef) {
    return undefined
  }

  // 2. Resolve the target ref to a SHA. Bad refs → undefined.
  const targetSha = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], opts)
  if (targetSha.status !== 0) {
    return undefined
  }
  const sha = targetSha.stdout.trim()
  if (!sha) {
    return undefined
  }

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
  if (isAncestor.status === 1) {
    return false
  }
  // Any other exit code (rare; e.g. corrupted refs) — bail.
  return undefined
}

let payloadRaw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  payloadRaw += chunk
})
process.stdin.on('end', () => {
  try {
    let payload: ToolInput
    try {
      payload = JSON.parse(payloadRaw) as ToolInput
    } catch {
      process.exit(0)
    }
    if (payload.tool_name !== 'Bash') {
      process.exit(0)
    }
    const command = payload.tool_input?.command ?? ''
    if (!command) {
      process.exit(0)
    }

    // Only fire on real `git revert` invocations (outside quotes).
    if (!containsOutsideQuotes(command, /\bgit\s+revert\b/)) {
      process.exit(0)
    }

    // Skip advanced workflows. `--no-commit` / `--no-edit` mean the
    // operator is mid-merge or scripting; the rebase suggestion
    // doesn't apply cleanly.
    if (/--no-(?:commit|edit)\b/.test(command)) {
      process.exit(0)
    }

    const ref = extractRef(command)
    if (!ref) {
      process.exit(0)
    }

    const pushed = isRefPushed(ref)
    if (pushed !== false) {
      // Pushed (= revert is correct), or unknowable (= don't false-
      // positive on a brand-new branch with no upstream).
      process.exit(0)
    }

    process.stderr.write(
      [
        '[prefer-rebase-over-revert-guard] Reminder: this commit looks unpushed.',
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
    // Always exit 0. The hook is a nudge, not an enforcer.
    process.exit(0)
  } catch (e) {
    process.stderr.write(
      `[prefer-rebase-over-revert-guard] hook error (allowing): ${e}\n`,
    )
    process.exit(0)
  }
})
