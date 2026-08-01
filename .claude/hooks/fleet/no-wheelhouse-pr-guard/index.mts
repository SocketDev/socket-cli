#!/usr/bin/env node
// Claude Code PreToolUse hook — no-wheelhouse-pr-guard.
//
// Blocks `gh pr create` / `gh pr new` when the target repo is socket-wheelhouse.
// The wheelhouse has never used pull requests: work lands by committing and
// pushing to LOCAL `main`, which is canonical and fast-moving (many parallel
// sessions land constantly, and an auto-committing cascade gate flattens
// in-flight drift). A PR against that trunk goes stale within minutes — it
// collects unrelated cascade commits, fails checks purely from staleness, and
// needs rebuilding against a moving target. All of that is work the PR itself
// created.
//
// Target detection (two independent signals, either one fires):
//   1. An explicit `--repo <owner/repo>` / `-R <owner/repo>` (or a URL) on the
//      `gh pr create` command that resolves to `SocketDev/socket-wheelhouse`.
//   2. Otherwise, the origin remote of the directory the command runs in — the
//      leading `cd <dir>` / hook cwd (shared extractGitCwd) — resolving to
//      `SocketDev/socket-wheelhouse` (`git remote get-url origin`, both
//      `git@github.com:…` and `https://github.com/…` spellings).
// Comparison is case-insensitive, `.git`-suffix tolerant.
//
// What it ALLOWS (never over-block):
//   - `gh pr create` against ANY non-wheelhouse repo — most fleet members and
//     every external repo are PR-based, and this must not touch them.
//   - `gh pr view/list/checks/comment/edit/close/merge` — reading and
//     responding to an existing PR is normal (a bot or outside contributor can
//     still open one against the mirror).
//   - `git push`, `gh release`, any non-`pr create` command.
//
// Bypass: `Allow wheelhouse PR`, typed by the HUMAN in a genuine user turn — an
// agent cannot self-authorize.
//
// Fails OPEN on git / parse errors: it guards one specific shape, it is not a
// general gh gate. (no-pr-in-squash-repo-guard is the fleet-wide trunk-repo
// version; this one is wheelhouse-targeted and works from any session's cwd.)

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { ghPrCreateCommands } from '../_shared/gh-pr-command.mts'
import { gitOut } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight trigger: every `gh pr create` carries the literal `pr` token — the
// substring the dispatcher gates on before importing this guard.
export const triggers: readonly string[] = ['pr']

export const BYPASS_PHRASE = 'Allow wheelhouse PR'

// The wheelhouse repo slug, lower-cased for case-insensitive comparison.
export const WHEELHOUSE_SLUG = 'socketdev/socket-wheelhouse'

/**
 * Reduce a git remote URL or a `gh --repo` value to a lower-cased
 * `owner/repo` slug, or undefined when it is not a recognizable GitHub repo
 * reference. Handles `git@github.com:Owner/Repo.git`,
 * `https://github.com/Owner/Repo(.git)`, `ssh://git@github.com/Owner/Repo`,
 * and the bare `Owner/Repo` / `HOST/Owner/Repo` forms `gh --repo` accepts.
 */
export function repoSlug(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  // Pull `owner/repo` off a GitHub remote in either spelling: `github.com/`
  // for an https URL or `github.com:` for the SSH form. Group 1 is the owner,
  // group 2 the repo name, matched lazily so an optional trailing `.git` and
  // an optional trailing slash are stripped rather than captured.
  const gh = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed)
  if (gh) {
    return `${gh[1]}/${gh[2]}`.toLowerCase()
  }
  // A URL for some OTHER host is a different repo — not the wheelhouse.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.includes('@')) {
    return undefined
  }
  const parts = trimmed
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean)
  if (parts.length < 2) {
    return undefined
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase()
}

/**
 * The value of a `gh` `--repo` / `-R` flag on `args`, in any of its spellings
 * (`--repo v`, `--repo=v`, `-R v`, `-Rv`), or undefined when absent.
 */
export function ghRepoFlag(args: readonly string[]): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === '--repo' || a === '-R') {
      return args[i + 1]
    }
    if (a.startsWith('--repo=')) {
      return a.slice('--repo='.length)
    }
    if (a.startsWith('-R') && a.length > 2) {
      return a.slice(2)
    }
  }
  return undefined
}

/**
 * True when a `gh pr create` in `command` targets socket-wheelhouse. Resolves
 * the target from an explicit `--repo`/`-R` first, else from the origin remote
 * of the command's effective directory.
 */
export function targetsWheelhouse(
  command: string,
  hookCwd?: string | undefined,
): boolean {
  const creates = ghPrCreateCommands(command)
  if (creates.length === 0) {
    return false
  }
  // The dir the command runs in: a leading `cd <dir>`, else the hook cwd.
  // extractGitCwd (unscoped) resolves both and tilde-expands the result.
  const dir = extractGitCwd(command, { cwd: hookCwd })
  let remoteSlug: string | undefined | 0 = 0 // 0 = not yet probed
  for (const c of creates) {
    const flag = ghRepoFlag(c.args)
    if (flag !== undefined) {
      if (repoSlug(flag) === WHEELHOUSE_SLUG) {
        return true
      }
      // An explicit --repo names a DIFFERENT repo — this invocation is not
      // wheelhouse-targeted regardless of cwd.
      continue
    }
    if (remoteSlug === 0) {
      const url = gitOut(dir, ['remote', 'get-url', 'origin'])
      remoteSlug = url ? repoSlug(url) : undefined
    }
    if (remoteSlug === WHEELHOUSE_SLUG) {
      return true
    }
  }
  return false
}

export function blockMessage(): string {
  return [
    '[no-wheelhouse-pr-guard] Refusing `gh pr create` — the target repo is',
    'socket-wheelhouse, which lands work to LOCAL `main`, never through pull',
    'requests. The wheelhouse has never had a PR.',
    '',
    'main is canonical and fast-moving: parallel sessions land constantly and',
    'the cascade gate auto-commits, so a PR branch goes stale within minutes —',
    'it collects unrelated cascade commits, fails checks purely from staleness,',
    'and needs rebuilding against a moving target. That is work the PR created.',
    '',
    'Land to local main instead (worktree, then advance main):',
    '  git -C <repo> worktree add --detach /tmp/wh-<name> $(git -C <repo> rev-parse main)',
    '  # ...edit + stage in /tmp/wh-<name>...',
    '  TREE=$(git -C /tmp/wh-<name> write-tree)',
    '  NEW=$(git -C /tmp/wh-<name> commit-tree $TREE -p <main-sha> -S -m "…")',
    '  git -C <repo> update-ref refs/heads/main $NEW <main-sha>   # CAS; retry if main moved',
    '',
    'Reading / responding to an existing PR (view/list/checks/comment) is always',
    'allowed — a bot or outside contributor can still open one against the mirror.',
    '',
    'If you genuinely must open a PR here, the user must type the EXACT phrase in',
    `a new message:  ${BYPASS_PHRASE}`,
  ].join('\n')
}

export const check = bashGuard((command, payload): GuardResult => {
  const hookCwd = (payload as { cwd?: string | undefined } | undefined)?.cwd
  if (!targetsWheelhouse(command, hookCwd)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, [BYPASS_PHRASE])) {
    return undefined
  }
  return block(blockMessage())
})

export const hook = defineHook({
  bypass: ['wheelhouse-pr'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
