// Git author/committer identity policy reader. The single source of truth is
// the wheelhouse-cascaded config FILE, resolved repo-scoped only (no machine-
// local fallback, by design — minimize outside-wheelhouse settings):
//
//   .config/repo/socket-wheelhouse.json → "gitAuthors", per-repo, optional
//   .config/fleet/git-authors.json, cascaded fleet default
//
// The per-repo half is a SECTION of the member settings file rather than its
// own JSON: per-repo config lives in ONE surface, and a second `.config/repo/
// *.json` is the fragmentation `no-new-config-guard` refuses.
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
  denylist?:
    | { emails?: string[] | undefined; names?: string[] | undefined }
    | undefined
  canonical?: GitAuthor | undefined
  aliases?: GitAuthor[] | undefined
}

// The per-repo half lives as a SECTION of the one member settings file, not
// as its own `.config/repo/*.json`. Per-repo config lives in ONE surface
// (`config-segregation`); a second file there is exactly the fragmentation
// `no-new-config-guard` exists to refuse.
const REPO_SETTINGS = '.config/repo/socket-wheelhouse.json'
const REPO_SETTINGS_KEY = 'gitAuthors'
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
 * The `gitAuthors` section of the member settings file, or undefined when the
 * file or the section is absent.
 */
function loadRepoSection(repoRoot: string): RawConfig | undefined {
  const settings = loadJson(path.join(repoRoot, REPO_SETTINGS)) as
    | { [REPO_SETTINGS_KEY]?: RawConfig | undefined }
    | undefined
  return settings?.[REPO_SETTINGS_KEY]
}

/**
 * Split a `git var GIT_AUTHOR_IDENT` / `GIT_COMMITTER_IDENT` string
 * (`Name <email> <unix-ts> <tz>`) into its name and email. A field git left
 * empty comes back as undefined rather than an empty string, so the denylist
 * and allowlist checks see the same "unset" shape either way.
 */
export function parseGitIdentLine(ident: string): GitAuthor {
  const match = /^(.*?)\s*<([^>]*)>/.exec(ident)
  return {
    name: match?.[1]?.trim() || undefined,
    email: match?.[2]?.trim() || undefined,
  }
}

/**
 * One config's denylist halves, each defaulted to empty.
 */
function readDenyEntries(config: RawConfig | undefined): {
  emails: string[]
  names: string[]
} {
  return {
    emails: config?.denylist?.emails ?? [],
    names: config?.denylist?.names ?? [],
  }
}

/**
 * The union of both denylists, lowercased. A repo can ADD denied identities;
 * the fleet denylist always applies, so neither side can shorten the other.
 */
function mergeIdentityDenyList(
  fleet: RawConfig | undefined,
  repo: RawConfig | undefined,
): { denyEmails: string[]; denyNames: string[] } {
  const fleetDeny = readDenyEntries(fleet)
  const repoDeny = readDenyEntries(repo)
  return {
    denyEmails: [...fleetDeny.emails, ...repoDeny.emails].map(e =>
      e.toLowerCase(),
    ),
    denyNames: [...fleetDeny.names, ...repoDeny.names].map(n =>
      n.toLowerCase(),
    ),
  }
}

/**
 * The allowlist half, taken whole from the first config that declares one:
 * the repo override when it names a canonical email or any alias, else the
 * cascaded fleet default.
 */
function selectIdentityAllowlist(
  fleet: RawConfig | undefined,
  repo: RawConfig | undefined,
): { canonical: GitAuthor; aliases: GitAuthor[] } {
  const repoHasAllow = !!repo?.canonical?.email || !!repo?.aliases?.length
  const src = repoHasAllow ? repo! : (fleet ?? {})
  return {
    aliases: Array.isArray(src.aliases) ? src.aliases : [],
    canonical: src.canonical ?? {},
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
  const repo = loadRepoSection(repoRoot)
  const { denyEmails, denyNames } = mergeIdentityDenyList(fleet, repo)
  const { aliases, canonical } = selectIdentityAllowlist(fleet, repo)
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
 * git fails on its own when no identity is set.
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
