/**
 * @file What `commits-have-no-ai-attribution` prints: the failure report for a
 *   scan that found actionable fingerprints, the clean summary, and the report
 *   for a branch whose release boundary is undefined. The failure report
 *   follows What / Where / Saw vs. wanted / Fix, quoting the offending trailer
 *   line or branch name so the reader never has to go hunting for it. The Fix
 *   section is scoped to what the scan actually found, and it stops short of
 *   telling anyone to rewrite published history — that decision belongs to
 *   whoever owns the commits, not to this check.
 */

import { describeReleaseBoundary } from './release-boundary.mts'

import type { UnreleasedLineError } from './commit-history.mts'
import type { AttributionScan } from './scan.mts'

/**
 * The informational lines a run adds beneath its verdict: what the boundary
 * froze, and which local branches carry an agent prefix without failing.
 * Empty when the run has nothing extra to say.
 */
export function formatScopeNotes(scan: AttributionScan): string[] {
  const notes: string[] = []
  if (scan.frozenCommits.length && scan.boundary) {
    notes.push(
      `[commits-have-no-ai-attribution] ${scan.frozenCommits.length} offending commit(s) at or below the ${describeReleaseBoundary(scan.boundary)} release boundary are frozen and not reported.`,
    )
  }
  if (scan.boundary?.kind === 'no-tags') {
    notes.push(
      '[commits-have-no-ai-attribution] the repository carries no tags, so nothing is released yet and the whole default-branch history is the unreleased tail.',
    )
  }
  if (scan.boundary?.kind === 'no-ancestor-tag') {
    const { ref, tagCount, tagPattern } = scan.boundary
    const shortfall = tagPattern
      ? `${tagCount} tag(s) match the declared release.releaseLine.tagPattern \`${tagPattern}\` but none is in ${ref}'s history`
      : `${tagCount} tag(s) exist but none is in ${ref}'s history`
    notes.push(
      `[commits-have-no-ai-attribution] no release boundary: ${shortfall}, so the whole branch was scanned.`,
    )
  }
  for (const finding of scan.localBranches) {
    notes.push(
      `[commits-have-no-ai-attribution] local branch "${finding.branch}" carries the "${finding.prefix}" AI-agent prefix. It is not published, so it does not fail; rename it before pushing.`,
    )
  }
  return notes
}

/**
 * The failure report for a scan that found something actionable.
 */
export function formatFindings(scan: AttributionScan): string {
  const lines: string[] = [
    '[commits-have-no-ai-attribution] AI-attribution fingerprint(s) found.',
    '',
    '  What: an AI-attribution commit trailer or an AI-agent branch prefix.',
    '  The fleet bans these as commit noise, and they are also read by the',
    '  public @unveil/identity engine, which scores them as automation signals',
    '  against the account that pushed them.',
    '',
  ]
  if (scan.commits.length) {
    lines.push(`  Where — ${scan.commits.length} commit(s) (${scan.scope}):`)
    for (const finding of scan.commits) {
      lines.push(`    - ${finding.sha.slice(0, 12)} ${finding.subject}`)
      lines.push(`      saw:    ${finding.line}`)
      lines.push(`      wanted: no attribution trailer (${finding.label})`)
    }
    lines.push('')
  }
  if (scan.branches.length) {
    lines.push(`  Where — ${scan.branches.length} branch(es):`)
    for (const finding of scan.branches) {
      lines.push(`    - ${finding.ref}`)
      lines.push(`      saw:    branch name "${finding.branch}"`)
      lines.push(
        `      wanted: no "${finding.prefix}" AI-agent prefix on the branch name`,
      )
    }
    lines.push('')
  }
  lines.push('  Fix:')
  if (scan.commits.length) {
    lines.push(
      '    - Unpushed commit, most recent: `git commit --amend` and delete the',
      '      trailer line.',
      '    - Unpushed span: `node scripts/fleet/strip-ai-attribution.mts --base',
      '      <ref>` rewrites the messages deterministically (or run an',
      '      interactive rebase and reword each one).',
      '    - Already pushed: rewriting published history is a separate decision',
      "      that is yours to make, not this check's. This check reports the",
      '      commits; it does not tell you to rewrite or republish them.',
    )
  }
  if (scan.branches.length) {
    lines.push(
      '    - Rename the branch to a Conventional-Commit-style name, e.g.',
      '      `git branch -m <old> refactor/<topic>`. A remote branch also needs',
      '      the new name pushed and the old ref retired, which is a decision',
      '      for whoever owns that branch.',
    )
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * The report for a scanned branch that carries findings but sits on no
 * released line, so frozen history cannot be told apart from actionable
 * history. Naming the two legal moves matters more than the finding list here:
 * printing the commits would invite a rewrite the check cannot justify.
 */
export function formatUnreleasedLine(
  error: UnreleasedLineError,
  repoRoot: string,
): string {
  return [
    '[commits-have-no-ai-attribution] the scanned branch is not on a released line.',
    '',
    '  What:   the release boundary is undefined, so a frozen published commit',
    '          cannot be told apart from one you can still fix.',
    `  Where:  ${repoRoot} — ${error.ref}`,
    `  Saw:    ${error.findingCount} AI-attribution finding(s), and none of the`,
    ...(error.tagPattern
      ? [
          `          ${error.tagCount} tag(s) matching the declared`,
          `          release.releaseLine.tagPattern \`${error.tagPattern}\` is in ${error.ref}'s`,
          '          history. The pattern is honored as declared: it is never',
          '          widened back to every tag, because the tags it excludes are',
          '          the build-asset tags it was written to keep out.',
        ]
      : [
          `          repository's ${error.tagCount} tag(s) is in ${error.ref}'s history.`,
        ]),
    '  Wanted: a release boundary reachable from the branch being scanned. The',
    '          newest tag by DATE is not a substitute — a repo can carry several',
    '          release lines at once, and the newest tag can belong to one that',
    '          never ships.',
    '  Fix:    Three legal moves, all explicit:',
    '          - Declare the line in .config/repo/socket-wheelhouse.json under',
    '            `release.releaseLine` — `branch` names the ref the customer',
    '            line lives on, `boundaryTag` names the boundary tag outright.',
    '          - Or correct `release.releaseLine.tagPattern` so it matches the',
    '            tags this line actually releases under, then push the missing',
    '            release tag if there is none yet.',
    '          - Or re-run with --all to audit every ref with no boundary at',
    '            all, accepting that published history will be listed.',
    '',
  ].join('\n')
}

/**
 * The clean-run summary.
 */
export function formatCleanSummary(scan: AttributionScan): string {
  const boundary = scan.boundary
    ? `, boundary ${describeReleaseBoundary(scan.boundary)}`
    : ''
  return `[commits-have-no-ai-attribution] ok — ${scan.commitsScanned} commit(s) (${scan.scope}${boundary}) and ${scan.branchesScanned} branch(es) carry no AI attribution.`
}
