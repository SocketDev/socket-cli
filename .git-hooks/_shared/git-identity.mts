// Git author/committer identity policy reader. The single source of truth is
// the wheelhouse-cascaded config FILE, resolved repo-scoped only (no machine-
// local fallback, by design — minimize outside-wheelhouse settings):
//
//   .config/repo/git-authors.json   (per-repo override, optional)
//   .config/fleet/git-authors.json  (cascaded fleet default)
//
// Shape: { denylist: { emails[], names[] }, canonical: {name,email}, aliases[] }.
//
// Two checks, deliberately distinct:
//   - isDeniedIdentity: a placeholder/sandbox identity (test@example.com, Test,
//     empty) that is NEVER valid anywhere — the universal fleet denylist.
//   - isAllowedAuthor: when an allowlist (canonical/aliases) is configured, the
//     email must be in it. With no allowlist configured, only the denylist
//     applies (so a repo without a .config/repo allowlist still blocks junk).
//
// This is the .git-hooks/ copy; .claude/hooks/fleet/_shared/git-identity.mts is
// a byte-equivalent copy for the other (separately-cascaded) hook tree — the
// shared thing is the config file, not cross-tree code.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface GitAuthor {
  readonly name?: string | undefined
  readonly email?: string | undefined
}

export interface IdentityPolicy {
  readonly denyEmails: readonly string[]
  readonly denyNames: readonly string[]
  readonly canonical: GitAuthor
  readonly aliases: readonly GitAuthor[]
}

interface RawConfig {
  denylist?: { emails?: string[]; names?: string[] } | undefined
  canonical?: GitAuthor | undefined
  aliases?: GitAuthor[] | undefined
}

const REPO_CONFIG = '.config/repo/git-authors.json'
const FLEET_CONFIG = '.config/fleet/git-authors.json'

function loadJson(file: string): RawConfig | undefined {
  if (!existsSync(file)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RawConfig
  } catch {
    return undefined
  }
}

/**
 * Resolve the identity policy: a repo override (.config/repo) takes precedence
 * over the cascaded fleet default (.config/fleet). The denylist merges both (a
 * repo can ADD denied identities but the fleet denylist always applies); the
 * allowlist is taken from the first config that declares a non-empty one.
 * `repoRoot` is the directory both config paths resolve against.
 */
export function readIdentityPolicy(repoRoot: string): IdentityPolicy {
  const fleet = loadJson(path.join(repoRoot, FLEET_CONFIG))
  const repo = loadJson(path.join(repoRoot, REPO_CONFIG))

  const denyEmails = [
    ...(fleet?.denylist?.emails ?? []),
    ...(repo?.denylist?.emails ?? []),
  ].map(e => e.toLowerCase())
  const denyNames = [
    ...(fleet?.denylist?.names ?? []),
    ...(repo?.denylist?.names ?? []),
  ].map(n => n.toLowerCase())

  // Allowlist: repo override wins when it declares one, else fleet's.
  const repoHasAllow = !!repo?.canonical?.email || !!repo?.aliases?.length
  const src = repoHasAllow ? repo! : (fleet ?? {})
  const canonical = src.canonical ?? {}
  const aliases = Array.isArray(src.aliases) ? src.aliases : []

  return { denyEmails, denyNames, canonical, aliases }
}

/**
 * True when an identity is on the universal denylist — a placeholder email
 * (exact, or a `*@domain` whole-domain wildcard) or a placeholder name.
 */
export function isDeniedIdentity(
  candidate: GitAuthor,
  policy: IdentityPolicy,
): boolean {
  const email = candidate.email?.toLowerCase() ?? ''
  const name = candidate.name?.toLowerCase() ?? ''
  for (let i = 0, { length } = policy.denyEmails; i < length; i += 1) {
    const pat = policy.denyEmails[i]!
    if (pat.startsWith('*@')) {
      if (email.endsWith(pat.slice(1))) {
        return true
      }
    } else if (email === pat) {
      return true
    }
  }
  return !!name && policy.denyNames.includes(name)
}

/**
 * True when `candidate`'s email is the canonical identity or an alias. When no
 * allowlist is configured (empty canonical + aliases), returns true — only the
 * denylist gates that repo. A candidate with no email is treated as allowed
 * (git fails on its own when no identity is set).
 */
export function isAllowedAuthor(
  candidate: GitAuthor,
  policy: IdentityPolicy,
): boolean {
  const email = candidate.email?.toLowerCase()
  if (!email) {
    return true
  }
  const hasAllowlist = !!policy.canonical.email || policy.aliases.length > 0
  if (!hasAllowlist) {
    return true
  }
  if (policy.canonical.email?.toLowerCase() === email) {
    return true
  }
  for (let i = 0, { length } = policy.aliases; i < length; i += 1) {
    if (policy.aliases[i]!.email?.toLowerCase() === email) {
      return true
    }
  }
  return false
}
