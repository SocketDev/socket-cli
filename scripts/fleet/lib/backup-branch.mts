/**
 * Canonical names for fleet recovery branches.
 */

const BACKUP_TIME_ZONE = 'America/New_York'
const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: BACKUP_TIME_ZONE,
  year: 'numeric',
})

export const BACKUP_BRANCH_RE = /^backup-\d{8}-\d{6}$/

/**
 * Any fleet backup / recovery branch: the canonical `backup-YYYYMMDD-HHMMSS`,
 * its legacy `backup-<label>` siblings, and the `backup/<label>` recovery refs
 * the squash / reorder / reset flows push before a destructive op. Broader than
 * `isCanonicalBackupBranch` on purpose — this decides what a release scans for
 * parked, un-landed work, not what the normalizer renames.
 */
export const ANY_BACKUP_BRANCH_RE = /^backup[-/]/

/**
 * A git command runner injected so the backup-branch scan stays pure and
 * testable — no real branches needed. Mirrors `runCapture`'s return shape.
 */
export type BackupBranchGitExec = (
  args: string[],
) => Promise<{ code: number; stdout: string }>

/**
 * A backup branch that carries commits the release base can't reach.
 */
export interface BackupBranchUnreleased {
  branch: string
  commits: string[]
}

export function isCanonicalBackupBranch(branch: string): boolean {
  return BACKUP_BRANCH_RE.test(branch)
}

/**
 * True for any fleet backup / recovery branch name (`backup-*` or
 * `backup/*`).
 */
export function isBackupBranch(branch: string): boolean {
  return ANY_BACKUP_BRANCH_RE.test(branch)
}

/**
 * List local backup branches carrying commits reachable from the branch but NOT
 * from `baseRef` (the release base — HEAD/main at release time). A non-empty
 * result means a release cut from `baseRef` would SILENTLY OMIT that parked
 * work — exactly the lose-work failure the fleet guards against. Never merges
 * anything; it only surfaces. Pure over the injected git exec: each branch's
 * unreleased commits come from `git log <baseRef>..<branch>` (equivalent to
 * `git rev-list <branch> ^<baseRef>`), rendered `<short> <subject>`.
 */
export async function findBackupBranchesWithUnreleasedCommits(
  baseRef: string,
  exec: BackupBranchGitExec,
): Promise<BackupBranchUnreleased[]> {
  const listed = await exec([
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/',
  ])
  if (listed.code !== 0) {
    return []
  }
  const branches = listed.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(branch => isBackupBranch(branch))
  const out: BackupBranchUnreleased[] = []
  for (let i = 0, { length } = branches; i < length; i += 1) {
    const branch = branches[i]!
    // eslint-disable-next-line no-await-in-loop -- serial per-branch git probe; backup branches are few
    const revs = await exec(['log', '--format=%h %s', `${baseRef}..${branch}`])
    if (revs.code !== 0) {
      continue
    }
    const commits = revs.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
    if (commits.length) {
      out.push({ branch, commits })
    }
  }
  return out
}

/**
 * Render a GitHub commit timestamp as the fleet's stable backup-ref format.
 */
export function formatBackupBranch(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO commit date: ${isoDate}`)
  }
  const parts = timestampFormatter.formatToParts(date)
  const byType = new Map(parts.map(part => [part.type, part.value]))
  return `backup-${byType.get('year')}${byType.get('month')}${byType.get('day')}-${byType.get('hour')}${byType.get('minute')}${byType.get('second')}`
}
