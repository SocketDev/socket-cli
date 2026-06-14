// Pure detection logic for clone-reviewed-repo-nudge, split out of index.mts so
// it can be unit-tested directly without the top-level stdin-draining guard
// harness (importing index.mts would block on readPayload()).

// Fleet repos live under this GitHub org; they are members, not external
// reference targets, so they never trip the nudge. Case-insensitive compare.
export const FLEET_ORG = 'socketdev'

// The smallest-practical clone flags, in the order we recommend them. Each
// `has` predicate tolerates the common spellings of an equivalent flag.
export const SMALLEST_FLAGS: ReadonlyArray<{
  readonly canonical: string
  readonly has: (args: readonly string[]) => boolean
}> = [
  {
    canonical: '--depth=1',
    has: args =>
      args.some(a => a === '--depth' || /^--depth=/.test(a)),
  },
  {
    canonical: '--single-branch',
    has: args => args.includes('--single-branch'),
  },
  {
    canonical: '--filter=blob:none',
    has: args => args.some(a => /^--filter=/.test(a)),
  },
]

/**
 * Parse `owner` + `repo` out of a GitHub remote URL or an `owner/repo`
 * shorthand. Returns undefined when the value is neither. Handles
 * `https://github.com/<o>/<r>(.git)`, `git@github.com:<o>/<r>(.git)`, and a
 * bare `<o>/<r>` slug.
 */
export function parseGithubSlug(
  value: string,
): { owner: string; repo: string } | undefined {
  const urlMatch = value.match(
    /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  )
  if (urlMatch) {
    return { owner: urlMatch[1]!, repo: urlMatch[2]! }
  }
  // Bare owner/repo slug (exactly one slash, no scheme, no host).
  if (!value.includes('://')) {
    const slugMatch = value.match(/^([\w.-]+)\/([\w.-]+)$/)
    if (slugMatch) {
      return { owner: slugMatch[1]!, repo: slugMatch[2]! }
    }
  }
  return undefined
}

/**
 * True when `owner` is the SocketDev fleet org (case-insensitive). Fleet
 * members are exempt from the external-clone nudge.
 */
export function isFleetOrg(owner: string): boolean {
  return owner.toLowerCase() === FLEET_ORG
}

/**
 * The standardized reference-clone directory name for a repo: `<org>-<repo>`,
 * lowercased + dash-cased. Mirrors getSocketRepoClonesDir()'s naming so the
 * nudge text matches what the path helper produces.
 */
export function repoClonesName(owner: string, repo: string): string {
  return `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/**
 * For a `git clone` segment's args, return the external GitHub repo being
 * cloned + the smallest-practical flags it is MISSING. Returns undefined when
 * the segment is not an external-repo clone (no clone subcommand, no GitHub
 * URL, or a fleet-org URL).
 */
export function missingCloneFlags(
  args: readonly string[],
): { owner: string; repo: string; missing: string[] } | undefined {
  if (!args.includes('clone')) {
    return undefined
  }
  // Find the first non-flag arg that parses as a GitHub remote URL.
  let parsed: { owner: string; repo: string } | undefined
  for (const a of args) {
    if (a.startsWith('-')) {
      continue
    }
    const candidate = parseGithubSlug(a)
    if (candidate) {
      parsed = candidate
      break
    }
  }
  if (!parsed || isFleetOrg(parsed.owner)) {
    return undefined
  }
  const missing = SMALLEST_FLAGS.filter(f => !f.has(args)).map(f => f.canonical)
  return { owner: parsed.owner, repo: parsed.repo, missing }
}

/**
 * For a `gh` command reviewing an external repo, return that repo. Looks at a
 * `gh repo view <slug>` positional and any `gh … --repo <slug>` / `-R <slug>`
 * / `--repo=<slug>`. Returns undefined when no external (non-fleet) GitHub repo
 * is referenced.
 */
export function externalGhRepo(
  args: readonly string[],
): { owner: string; repo: string } | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    // `--repo <slug>` / `-R <slug>`.
    if (a === '--repo' || a === '-R') {
      const next = args[i + 1]
      const parsed = next ? parseGithubSlug(next) : undefined
      if (parsed && !isFleetOrg(parsed.owner)) {
        return parsed
      }
      continue
    }
    // `--repo=<slug>`.
    const eq = a.match(/^--repo=(.+)$/)
    if (eq) {
      const parsed = parseGithubSlug(eq[1]!)
      if (parsed && !isFleetOrg(parsed.owner)) {
        return parsed
      }
      continue
    }
    // Bare `owner/repo` positional (e.g. `gh repo view owner/repo`).
    if (!a.startsWith('-')) {
      const parsed = parseGithubSlug(a)
      if (parsed && !isFleetOrg(parsed.owner)) {
        return parsed
      }
    }
  }
  return undefined
}
