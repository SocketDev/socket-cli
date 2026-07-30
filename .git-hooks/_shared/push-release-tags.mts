// Release-tag exemption for the pre-push range scans.
//
// A commit reachable from a published release tag is immutable. The only way to
// change its message is to rewrite it, which changes its SHA, which changes
// every descendant SHA — orphaning the tag that points at it. A gate whose sole
// remedy is a rewrite cannot be satisfied for such a commit, so this module
// narrows a pushed range down to the commits that are still rewritable.
//
// The exemption is deliberately narrow:
//   - ONLY commits reachable from a release tag qualify. "Already on a remote
//     branch" is not a reason to skip — a branch can still be force-updated, so
//     its commits stay rewritable and stay scanned.
//   - Only a tag whose own commit is inside the pushed range counts. A tag
//     behind the range base already has its ancestors excluded by the base.
//   - The tag must be present on the push remote AND resolve to the same commit
//     there. A local-only tag, or a local tag re-pointed at a different commit,
//     exempts nothing.
//   - When the remote cannot be read, nothing is exempt (fail closed) and the
//     unverified tags are named in the notice.

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { git, gitLines } from './git.mts'

const logger = getDefaultLogger()

// How many exempt commits the notice names before it summarizes the rest.
const EXEMPT_SAMPLE_LIMIT = 5

// Fleet release tags are semver with an OPTIONAL `v` prefix: socket-mcp carries
// both `0.0.10` and `v0.0.9`, socket-lib and socket-sdk-js are `v`-prefixed,
// socket-cli has both. Reading the repo's own `git tag --list` and keeping the
// semver-shaped names covers every convention without hard-coding one repo's
// prefix. Names that are not semver-shaped (`backup/…`,
// `socket-lib-prebump-backup`, `base-assets-node-smol-20260418-50af4c8`) are
// working tags, not published releases, and grant no exemption.
export const RELEASE_TAG_RE =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]+)?$/

// One exempt commit. `oneline` is populated for the sampled head of the list
// and is an empty string for the remainder, so the notice stays cheap on a
// range that republishes a long tagged history.
export interface ExemptCommit {
  oneline: string
  sha: string
}

// The split of a pushed range into what a rewrite-remedy gate may act on
// (`scanned`) and what a published tag has frozen (`exempt`). `tags` names the
// published release tags responsible for the skip; `unverifiedTags` names
// release tags inside the range whose publication could NOT be confirmed on the
// remote — those grant no exemption and their commits stay in `scanned`.
export interface ReleaseTagExemption {
  exempt: ExemptCommit[]
  scanned: string[]
  tags: string[]
  unverifiedTags: string[]
}

export interface ReleaseTagOptions {
  cwd?: string | undefined
}

// `git -C <cwd>` prefix so the resolver can run against a repo other than the
// process cwd (the hook uses the cwd; tests point at a fixture).
function repoArgs(cwd: string | undefined): string[] {
  return cwd ? ['-C', cwd] : []
}

export function isReleaseTagName(name: string): boolean {
  return RELEASE_TAG_RE.test(name)
}

// Every local release tag mapped to the COMMIT it names. Annotated tags resolve
// through the peeled `*objectname`; lightweight tags use `objectname`.
export function listLocalReleaseTagCommits(
  options?: ReleaseTagOptions | undefined,
): Map<string, string> {
  const { cwd } = { __proto__: null, ...options } as ReleaseTagOptions
  const lines = gitLines(
    ...repoArgs(cwd),
    'for-each-ref',
    '--format=%(refname:short) %(objectname) %(*objectname)',
    'refs/tags',
  )
  const found = new Map<string, string>()
  for (const line of lines) {
    const [name, objectName, peeled] = line.trim().split(/\s+/)
    if (!name || !isReleaseTagName(name)) {
      continue
    }
    const commit = peeled || objectName
    if (commit) {
      found.set(name, commit)
    }
  }
  return found
}

// Every release tag the push remote already carries, mapped to the commit it
// names there. Best effort: `git` yields an empty string when the remote is
// unreachable, which leaves the map empty so nothing is exempted.
export function listPublishedReleaseTagCommits(
  remote: string,
  options?: ReleaseTagOptions | undefined,
): Map<string, string> {
  const { cwd } = { __proto__: null, ...options } as ReleaseTagOptions
  const found = new Map<string, string>()
  const raw = git(...repoArgs(cwd), 'ls-remote', '--tags', remote)
  if (!raw) {
    return found
  }
  const rawLines = raw.split('\n')
  for (let i = 0, { length } = rawLines; i < length; i += 1) {
    const [sha, ref] = rawLines[i]!.trim().split(/\s+/)
    if (!sha || !ref) {
      continue
    }
    // An annotated tag emits two lines. `refs/tags/<name>` names the tag
    // object, and `refs/tags/<name>^{}` names the commit that tag peels to.
    // Note: the peeled line wins whenever both are present.
    const isPeeled = ref.endsWith('^{}')
    const name = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')
    if (!isReleaseTagName(name)) {
      continue
    }
    if (isPeeled || !found.has(name)) {
      found.set(name, sha)
    }
  }
  return found
}

// Splits `range` into the commits a rewrite-remedy gate may still act on and
// the commits a published release tag has frozen. A repo with no release tags
// in the range returns every commit in `scanned`, which is the unnarrowed
// behavior.
export function resolveRewritableCommits(
  range: string,
  remote: string,
  options?: ReleaseTagOptions | undefined,
): ReleaseTagExemption {
  const { cwd } = { __proto__: null, ...options } as ReleaseTagOptions
  const repo = repoArgs(cwd)
  const inRange = gitLines(...repo, 'rev-list', range).filter(Boolean)
  const unnarrowed: ReleaseTagExemption = {
    exempt: [],
    scanned: inRange,
    tags: [],
    unverifiedTags: [],
  }
  if (inRange.length === 0) {
    return unnarrowed
  }
  const localTags = listLocalReleaseTagCommits({ cwd })
  if (localTags.size === 0) {
    return unnarrowed
  }
  const inRangeShas = new Set(inRange)
  const candidates = [...localTags].filter(([, sha]) => inRangeShas.has(sha))
  if (candidates.length === 0) {
    return unnarrowed
  }
  const publishedTags = listPublishedReleaseTagCommits(remote, { cwd })
  const published: string[] = []
  const unverifiedTags: string[] = []
  for (const [name, sha] of candidates) {
    if (publishedTags.get(name) === sha) {
      published.push(name)
    } else {
      unverifiedTags.push(name)
    }
  }
  if (published.length === 0) {
    return { ...unnarrowed, unverifiedTags }
  }
  // Spell the exclusions as full refs so a tag named like a branch cannot
  // resolve to the wrong object.
  const kept = new Set(
    gitLines(
      ...repo,
      'rev-list',
      range,
      '--not',
      ...published.map(name => `refs/tags/${name}`),
    ),
  )
  const scanned: string[] = []
  const exempt: ExemptCommit[] = []
  for (let i = 0, { length } = inRange; i < length; i += 1) {
    const sha = inRange[i]!
    if (kept.has(sha)) {
      scanned.push(sha)
    } else {
      exempt.push({
        oneline:
          exempt.length < EXEMPT_SAMPLE_LIMIT
            ? git(...repo, 'log', '-1', '--oneline', sha)
            : '',
        sha,
      })
    }
  }
  return { exempt, scanned, tags: published, unverifiedTags }
}

// Notice lines for an exemption. Pure — the caller logs them. Returns an empty
// array when there is nothing to disclose, so a repo with no release tags emits
// no extra output at all.
export function formatReleaseTagExemption(
  exemption: ReleaseTagExemption,
  scanLabel: string,
): string[] {
  const { exempt, tags, unverifiedTags } = exemption
  const lines: string[] = []
  if (exempt.length > 0) {
    lines.push(
      `Skipping ${exempt.length} commit(s) in this range for the ${scanLabel} check:`,
    )
    const oneTag = tags.length === 1
    lines.push(
      `  release ${oneTag ? 'tag' : 'tags'} ${joinAnd(tags)} already ${oneTag ? 'publishes' : 'publish'} them.`,
    )
    lines.push(
      '  A published tag pins these SHAs — rewriting one orphans the tag, so',
    )
    lines.push('  this check has no remedy to offer for them.')
    const sample = exempt.slice(0, EXEMPT_SAMPLE_LIMIT)
    for (let i = 0, { length } = sample; i < length; i += 1) {
      const commit = sample[i]!
      lines.push(`    - ${commit.oneline || commit.sha}`)
    }
    if (exempt.length > EXEMPT_SAMPLE_LIMIT) {
      lines.push(`    ... and ${exempt.length - EXEMPT_SAMPLE_LIMIT} more`)
    }
  }
  if (unverifiedTags.length > 0) {
    lines.push(
      `Release ${unverifiedTags.length === 1 ? 'tag' : 'tags'} ${joinAnd(unverifiedTags)} could not be confirmed on the push remote — scanning those commits.`,
    )
  }
  return lines
}

export function reportReleaseTagExemption(
  exemption: ReleaseTagExemption,
  scanLabel: string,
): void {
  const lines = formatReleaseTagExemption(exemption, scanLabel)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    logger.info(lines[i]!)
  }
}
