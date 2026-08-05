/*
 * @file Pure analysis of the commit range `consolidate-commits.mts` is about to
 *   regroup: parsing the range's commits out of one `git log` payload, spotting
 *   the breaking-change commits that make the regroup refuse, and spotting the
 *   commits whose existing message says more than the generated one will.
 *
 *   Nothing here spawns git. The caller reads the range with
 *   `RANGE_LOG_FORMAT`, hands the raw text to `parseRangeCommits`, and every
 *   verdict below is a pure function over those records.
 */

// ASCII unit/record separators: neither can appear in a git subject or body,
// so they frame the fields with no escaping pass.
const FIELD_SEP = '\u001f'
const RECORD_SEP = '\u001e'

/**
 * The `git log` format that produces `parseRangeCommits`' input.
 */
export const RANGE_LOG_FORMAT = `--format=%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`

// Conventional Commits marks a breaking change with a `!` immediately before
// the colon: `feat(parse)!: …`. The scope is optional.
const BREAKING_SUBJECT_RE = /^[a-z]+(?:\([^)]*\))?!:/
// The footer form, at the start of a body line. Both spellings are canonical.
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:/m
// `<type>[(scope)][!]: ` — the leading type token of a conventional subject.
const CONVENTIONAL_SUBJECT_RE = /^([a-z]+)(?:\([^)]*\))?!?:/

// Types that name WHAT changed for a consumer. The regroup's messages are
// path-derived and land on `chore`/`refactor`, so an existing subject carrying
// one of these describes the change more precisely than anything groupPaths
// can synthesize.
const SEMANTIC_TYPES: ReadonlySet<string> = new Set([
  'feat',
  'fix',
  'perf',
  'revert',
  'security',
])

/**
 * One commit in the range being regrouped.
 */
export interface RangeCommit {
  readonly body: string
  readonly sha: string
  readonly subject: string
}

/**
 * Parse `git log --format=%H%x1f%s%x1f%b%x1e` output into records.
 */
export function parseRangeCommits(raw: string): RangeCommit[] {
  const out: RangeCommit[] = []
  const records = raw.split(RECORD_SEP)
  for (let i = 0, { length } = records; i < length; i += 1) {
    const record = records[i]!.trim()
    if (!record) {
      continue
    }
    const fields = record.split(FIELD_SEP)
    const sha = fields[0] ?? ''
    if (sha) {
      out.push({ body: fields[2] ?? '', sha, subject: fields[1] ?? '' })
    }
  }
  return out
}

/**
 * Whether a commit declares a semver-breaking change, by either Conventional
 * Commits marker: a `!` before the subject's colon, or a `BREAKING CHANGE:`
 * body footer.
 */
export function isBreakingCommit(commit: {
  body: string
  subject: string
}): boolean {
  const c = { __proto__: null, ...commit } as { body: string; subject: string }
  return BREAKING_SUBJECT_RE.test(c.subject) || BREAKING_FOOTER_RE.test(c.body)
}

/**
 * The commits in the range that declare a breaking change. Regrouping folds
 * commits by PATH, so a breaking commit's subject and its `!` marker are lost
 * into a generic path-derived message — the release tooling that reads those
 * markers to compute the next semver then silently downgrades a major.
 */
export function findBreakingCommits(
  commits: readonly RangeCommit[],
): RangeCommit[] {
  const out: RangeCommit[] = []
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    if (isBreakingCommit(commit)) {
      out.push(commit)
    }
  }
  return out
}

/**
 * The conventional type token of a subject, or undefined when the subject is
 * not conventional.
 */
export function conventionalCommitType(subject: string): string | undefined {
  const m = CONVENTIONAL_SUBJECT_RE.exec(subject)
  return m ? m[1] : undefined
}

/**
 * Commits whose EXISTING message is more specific than anything the regroup
 * would generate: the commit names a semantic type and no generated message
 * carries that same type, so the detail is dropped rather than restated.
 * Advisory — the operator decides whether the regroup is still worth it.
 */
export function findLessSpecificRegroups(
  commits: readonly RangeCommit[],
  generatedSubjects: readonly string[],
): RangeCommit[] {
  const generatedTypes = new Set<string>()
  for (let i = 0, { length } = generatedSubjects; i < length; i += 1) {
    const type = conventionalCommitType(generatedSubjects[i]!)
    if (type !== undefined) {
      generatedTypes.add(type)
    }
  }
  const out: RangeCommit[] = []
  for (let i = 0, { length } = commits; i < length; i += 1) {
    const commit = commits[i]!
    const type = conventionalCommitType(commit.subject)
    if (
      type !== undefined &&
      SEMANTIC_TYPES.has(type) &&
      !generatedTypes.has(type)
    ) {
      out.push(commit)
    }
  }
  return out
}
