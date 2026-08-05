/**
 * @file Decide which already-open dependency PRs the rolling PR replaces.
 *   Switching to one long-lived branch does NOT retroactively adopt the PRs
 *   opened before the switch. Those sit on per-run branches, and several of
 *   them were named by an agent rather than by a format string, so there is no
 *   pattern to match on: socket-vscode alone had `deps/promote-soaked-<date>`,
 *   `daily-deps-update-<date>`, and `backup/daily-deps-update-<date>` from
 *   three consecutive runs. Looking them up by head branch finds nothing, so
 *   without this step the first rolling run opens PR number four and leaves
 *   three stale ones behind it.
 *   Identity is therefore the label pair the workflow itself applies, plus a
 *   bot author, plus "not the rolling branch". Kept deliberately narrow: this
 *   closes pull requests, so a false positive costs someone their work. A PR
 *   missing either label, or authored by a human, is never touched.
 */

// Both must be present. The workflow applies both when it opens a PR, so this
// pair identifies our own automation rather than any dependency PR at large.
// Dependabot, for one, carries `dependencies` but not `automation`.
export const REQUIRED_LABELS: readonly string[] = ['dependencies', 'automation']

export type OpenPr = {
  number: number
  headRefName: string
  labels: readonly string[]
  authorIsBot: boolean
}

/**
 * True when `pr` is one of ours from before the rolling switch.
 */
export function isSuperseded(pr: OpenPr, rollingBranch: string): boolean {
  if (pr.headRefName === rollingBranch) {
    return false
  }
  if (!pr.authorIsBot) {
    return false
  }
  return REQUIRED_LABELS.every(label => pr.labels.includes(label))
}

/**
 * The PR numbers the rolling PR replaces, oldest first so the closing comments
 * read in the order the runs happened.
 */
export function supersededPrNumbers(
  prs: readonly OpenPr[],
  rollingBranch: string,
): number[] {
  return prs
    .filter(pr => isSuperseded(pr, rollingBranch))
    .map(pr => pr.number)
    .toSorted((a, b) => a - b)
}

/**
 * What to say on a PR being closed, pointing at its replacement.
 */
export function closingComment(rollingBranch: string): string {
  return [
    'Superseded by the rolling dependency PR.',
    '',
    `Dependency updates now land on one long-lived \`${rollingBranch}\` branch,`,
    'rebuilt from the default branch on every run, with each run recorded as a',
    'dated fold in that PR body. This one predates the switch and would only go',
    'stale, so it is being closed rather than left open.',
  ].join('\n')
}
