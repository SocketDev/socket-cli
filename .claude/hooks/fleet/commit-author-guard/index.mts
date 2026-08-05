#!/usr/bin/env node
// Claude Code PreToolUse hook — commit-author-guard.
//
// Blocks `git commit` invocations whose author is a denied placeholder
// identity, or, when an allowlist is configured, not on it. Catches:
//
//   1. Wrong --author override:
//        git commit --author="Test <test@example.com>" -m "..."
//   2. Wrong -c user.email override:
//        git commit -c user.email=test@example.com -m "..."
//   3. Local checkout user.email is a placeholder / off-allowlist.
//
// Identity policy is the cascaded, wheelhouse-scoped config (read by the
// shared .git-hooks/_shared/git-identity.mts — the SAME source the commit-msg
// git-stage backstop uses, so the two never diverge):
//   .config/repo/git-authors.json, per-repo override, optional
//   .config/fleet/git-authors.json, cascaded fleet default
// No machine-local (~/) source by design. The fleet config ships the universal
// DENYLIST, placeholder identities never valid anywhere; the ALLOWLIST
// (canonical/aliases) is per-repo. A denylist hit is ALWAYS blocked; an
// allowlist-miss is blocked only when an allowlist is configured.
//
// This guard covers Claude `git commit` TOOL CALLS; subprocess / worktree / CI
// commits are caught by the commit-msg git-stage backstop.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isGitCommit } from '../_shared/commit-command.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
// Cross-tree shared reader (canonical home: .git-hooks/_shared/). The DATA it
// reads is the cascaded .config/fleet|repo/git-authors.json — the single
// source of truth shared with the commit-msg git-stage backstop.
import {
  isAllowedAuthor,
  isDeniedIdentity,
  readIdentityPolicy,
} from '../../../../.git-hooks/_shared/git-identity.mts'
import type { GitAuthor } from '../../../../.git-hooks/_shared/git-identity.mts'
import { verdictLine } from '../_shared/verdict.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

export { isGitCommit }

// Parse a `git commit ...` command for explicit author overrides.
// Three forms we recognize:
//
//   --author="Name <email@example>"
//   --author "Name <email@example>"
//   -c user.email=email@example -c user.name=Name
//
// Returns the override author if any, otherwise undefined.
export function parseAuthorOverride(command: string): GitAuthor | undefined {
  // --author="Name <email>"  or  --author='Name <email>'
  const authorEq =
    /--author=(?<q>['"]?)(?<name>[^'"<>]+)\s*<(?<email>[^>]+)>\k<q>/i.exec(
      command,
    )
  if (authorEq) {
    return {
      name: authorEq.groups!['name']!.trim(),
      email: authorEq.groups!['email']!.trim(),
    }
  }
  // --author "Name <email>"
  const authorSpace =
    /--author\s+(?<q>['"])(?<name>[^'"<>]+)\s*<(?<email>[^>]+)>\k<q>/i.exec(
      command,
    )
  if (authorSpace) {
    return {
      name: authorSpace.groups!['name']!.trim(),
      email: authorSpace.groups!['email']!.trim(),
    }
  }
  // -c user.email=...
  const cEmail = /-c\s+user\.email=(?<email>[^\s'"]+)/i.exec(command)
  const cName =
    /-c\s+user\.name=(?:(?<q>['"])(?<quotedName>[^'"]+)\k<q>|(?<bareName>[^\s]+))/i.exec(
      command,
    )
  if (cEmail || cName) {
    return {
      email: cEmail?.groups?.['email'],
      name: cName
        ? (cName.groups?.['quotedName'] ?? cName.groups?.['bareName'])
        : undefined,
    }
  }
  return undefined
}

// Read the local checkout's user.email + user.name. Falls through to
// undefined on failure. Used when the command has no explicit override
// — we need to know what git would use by default.
export function readCheckoutAuthor(cwd: string | undefined): GitAuthor {
  let email: string | undefined
  let name: string | undefined
  const opts = cwd ? { cwd } : {}
  const emailResult = spawnSync('git', ['config', 'user.email'], opts)
  if (emailResult.status === 0) {
    email = String(emailResult.stdout).trim() || undefined
  }
  const nameResult = spawnSync('git', ['config', 'user.name'], opts)
  if (nameResult.status === 0) {
    name = String(nameResult.stdout).trim() || undefined
  }
  return { name, email }
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }

  // Policy comes from the cascaded config (.config/fleet|repo/git-authors.json),
  // rooted at the commit's cwd. Same source the commit-msg backstop reads.
  const policy = readIdentityPolicy(resolveProjectDir(payload.cwd))

  // Determine the effective author for this commit.
  const override = parseAuthorOverride(command)
  const effective: GitAuthor = override ?? readCheckoutAuthor(payload.cwd)

  // Two distinct gates: a denied placeholder identity is ALWAYS blocked; an
  // allowlist-miss is blocked only when an allowlist is configured.
  const denied = isDeniedIdentity(effective, policy)
  if (!denied && isAllowedAuthor(effective, policy)) {
    return undefined
  }

  const who = `${effective.name ?? '(unset)'} <${effective.email ?? '(unset)'}>`
  const reason = denied
    ? 'a placeholder/sandbox identity'
    : 'not the allowed identity'
  const fix = policy.canonical.email
    ? `git config user.email "${policy.canonical.email}"`
    : 'git config user.email "<you>@<domain>" && git config user.name "<Your Name>"'
  const lines = [
    verdictLine(
      'block',
      'commit-author-guard',
      `blocked commit author "${who}" (${reason}) — fix: ${fix} (policy: .config/{repo,fleet}/git-authors.json)`,
    ),
  ]
  const allowed: string[] = []
  if (policy.canonical.email) {
    allowed.push(
      `canonical ${policy.canonical.name ?? '(unset)'} <${policy.canonical.email}>`,
    )
  }
  if (policy.aliases.length > 0) {
    allowed.push(
      `aliases ${policy.aliases
        .map(a => `${a.name ?? '(any)'} <${a.email ?? '(any)'}>`)
        .join(', ')}`,
    )
  }
  if (allowed.length > 0) {
    lines.push(`   allowed: ${allowed.join('; ')}`)
  }
  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['commit-author'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
