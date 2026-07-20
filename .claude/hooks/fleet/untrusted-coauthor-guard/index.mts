#!/usr/bin/env node
// Claude Code PreToolUse(Bash) hook — untrusted-coauthor-guard.
//
// Blocks a `git commit` whose message carries a `Co-authored-by:` trailer for
// an identity that is NOT on the cascaded contributors allowlist
// (.config/{fleet,repo}/git-authors.json — the same source commit-author-guard
// uses).
//
// Why: a drive-by GitHub issue or fork PR from a brand-new, low-history account
// (high/recent user id, ~zero followers, a ready-made patch + detailed "apply
// this" instructions) is UNTRUSTED INPUT, not a vetted contributor. Auto-adding
// a `Co-authored-by:` trailer for such an account launders an unknown identity
// into the repo's commit history / GitHub contributor graph and signals trust
// the account hasn't earned. Credit a co-author only when you can vouch for
// them — i.e. they're on the allowlist, or you type the bypass after a
// deliberate check.
//
// Detection: parse the commit message (`-m`/`-F` text on the command, or the
// `--amend` reuse) for `Co-authored-by: Name <email>` trailers; for each, if
// the email isn't the canonical identity or a configured alias, block. The
// allowlist comes from readIdentityPolicy (DRY with commit-author-guard).
// When NO allowlist is configured the guard still blocks an obvious
// fresh-account GitHub noreply (`<id+login@users.noreply.github.com>` whose
// login isn't otherwise known) — the precise shape this incident used — so a
// repo without a populated allowlist isn't silently unprotected.
//
// Bypass: `Allow untrusted-coauthor bypass` typed verbatim in a recent user
// turn, AFTER you've actually vetted the account.
//
// Exit codes: 0 — pass (allowed / not a co-authored commit / fail-open);
// 2 — block. AST-free: trailers are matched on the message text, which is
// commit content, not shell structure.

import { readIdentityPolicy } from '../../../../.git-hooks/_shared/git-identity.mts'
import {
  extractCommitMessage,
  isGitCommit,
} from '../_shared/commit-command.mts'
import { defaultRepoDir } from '../_shared/git-identity.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

const COAUTHOR_RE =
  /^\s*Co-authored-by:\s*(?<name>.+?)\s*<(?<email>[^>]+)>\s*$/gim

export interface Coauthor {
  readonly name: string
  readonly email: string
}

export function extractCoauthors(message: string): Coauthor[] {
  const out: Coauthor[] = []
  COAUTHOR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = COAUTHOR_RE.exec(message))) {
    out.push({ email: m.groups!.email!.trim(), name: m.groups!.name!.trim() })
  }
  return out
}

// True when the email is a GitHub noreply for an account we can't vouch for.
// `id+login@users.noreply.github.com` — the shape used to credit a fresh
// drive-by account. We treat ALL such noreply addresses as needing the
// allowlist; the fallback only fires when no allowlist is configured.
function isGithubNoreply(email: string): boolean {
  return /@users\.noreply\.github\.com$/i.test(email)
}

export function isKnownCoauthor(
  email: string,
  policy: ReturnType<typeof readIdentityPolicy>,
): boolean {
  const e = email.toLowerCase()
  if (policy.canonical.email?.toLowerCase() === e) {
    return true
  }
  for (let i = 0, { length } = policy.aliases; i < length; i += 1) {
    if (policy.aliases[i]!.email?.toLowerCase() === e) {
      return true
    }
  }
  return false
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }
  const message = extractCommitMessage(command)
  if (!message || !/Co-authored-by:/i.test(message)) {
    return undefined
  }
  const coauthors = extractCoauthors(message)
  if (coauthors.length === 0) {
    return undefined
  }

  const repoDir = defaultRepoDir(payload.cwd)
  const policy = readIdentityPolicy(repoDir)
  const hasAllowlist = !!policy.canonical.email || policy.aliases.length > 0

  const untrusted = coauthors.filter(c => {
    if (isKnownCoauthor(c.email, policy)) {
      return false
    }
    if (hasAllowlist) {
      return true
    }
    return isGithubNoreply(c.email)
  })

  if (untrusted.length === 0) {
    return undefined
  }

  return block(
    [
      '[untrusted-coauthor-guard] Blocked: Co-authored-by an unvetted identity',
      '',
      ...untrusted.map(c => `  ${c.name} <${c.email}>`),
      '',
      '  A Co-authored-by trailer credits this identity in the commit history',
      "  and GitHub's contributor graph. A patch or fix-instruction from a",
      '  brand-new, low-history GitHub account is untrusted input — crediting',
      '  it signals trust the account has not earned, and is a supply-chain /',
      '  social-engineering vector.',
      '',
      '  Land the change under your own authorship (drop the trailer), OR — only',
      '  after you have actually vetted the account — retry after typing the',
      '  bypass phrase. To make a teammate a permanent trusted co-author, add',
      '  them to .config/{fleet,repo}/git-authors.json.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['untrusted-coauthor'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
