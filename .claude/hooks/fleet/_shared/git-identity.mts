/**
 * @file Git author-identity helpers shared across hooks. A placeholder author
 *   email (`*@example.com`, a CI-bot like `agent-ci@example.com`, an RFC-2606
 *   reserved domain) can't be verified against a signing key on GitHub, so a
 *   commit authored with one is rejected by `required_signatures` even when the
 *   signature itself is valid. Two hooks key off the same set: `git-config-
 *   write-guard` auto-unsets such a LOCAL identity at SessionStart, and
 *   `git-identity-drift-nudge` warns at Stop when the EFFECTIVE identity is a
 *   placeholder before a push. Kept here (gate-free `_shared`) so the pattern
 *   set lives once, not copy-pasted into two hooks that would then drift.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { spawnTimeoutMs } from './spawn-timeout.mts'
import { resolveProjectDir } from './project-dir.mts'

// Placeholder author emails that GitHub can't verify against a signing key:
//   - any RFC-2606 reserved domain (example.com/org/net, *.example)
//   - CI-bot identities (agent-ci@…) planted by a container entrypoint
//   - localhost / invalid / test pseudo-domains
// A real human/org email (gmail.com, socket.dev, …) does NOT match.
export const PLACEHOLDER_EMAIL_PATTERNS: readonly RegExp[] = [
  /@example\.(?:com|net|org)\b/i,
  /\.example\b/i,
  /\bagent-ci@/i,
  /@(?:invalid|localhost|test)\b/i,
]

export function isPlaceholderEmail(email: string): boolean {
  const trimmed = email.trim()
  if (!trimmed) {
    return false
  }
  for (let i = 0, { length } = PLACEHOLDER_EMAIL_PATTERNS; i < length; i += 1) {
    if (PLACEHOLDER_EMAIL_PATTERNS[i]!.test(trimmed)) {
      return true
    }
  }
  return false
}

/**
 * The EFFECTIVE git `user.email` resolved from `dir` (local over global, the
 * value git itself would stamp on a commit). Empty string when git is
 * unavailable or no identity is set.
 */
export function effectiveUserEmail(dir: string): string {
  const r = spawnSync('git', ['config', '--get', 'user.email'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return ''
  }
  return String(r.stdout).trim()
}

/**
 * True when a GLOBAL `user.email` exists to fall back to. Auto-fixers use this
 * to decide whether unsetting a placeholder LOCAL identity is safe (won't
 * strand the repo with no author).
 */
export function hasGlobalIdentity(): boolean {
  const r = spawnSync('git', ['config', '--global', '--get', 'user.email'], {
    encoding: 'utf8',
    timeout: spawnTimeoutMs(5000),
  })
  return r.status === 0 && String(r.stdout).trim().length > 0
}

/**
 * The hook's own cwd, used as the default repo dir when a payload carries no
 * explicit cwd. Kept here so both hooks resolve the same way.
 */
export function defaultRepoDir(payloadCwd?: string | undefined): string {
  return resolveProjectDir(payloadCwd)
}
