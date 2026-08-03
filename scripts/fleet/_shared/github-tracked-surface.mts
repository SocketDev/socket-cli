/*
 * @file The GitHub CI surface a fleet member must ALWAYS git-track, even when
 *   thin. GitHub reads both from the committed default-branch tree BEFORE any
 *   fetch step could run: a scheduled workflow registers its cron from the
 *   committed file, and a `uses: ./.github/actions/...` composite must exist at
 *   checkout. So these paths never enter the thin untrack set — the release
 *   bundle still ships them, but they reach members in the cascade COMMIT,
 *   tracked. ONE declaration shared by the dep-0 bootstrap installer
 *   (`thinIgnoreEntries` excludes them) and the enforcing check
 *   (`thin-untrack-set-is-ci-safe`), so the two can never disagree. Pure — no
 *   imports — so rolldown inlines it into the dep-0 `fleet.mjs` without pulling
 *   anything into the bare-node fetcher. See
 *   docs/agents.md/fleet/thin-distribution.md ("Always tracked: the GitHub
 *   surface").
 */

// Repo-relative path prefixes GitHub reads at rest from the committed tree.
// `.github/actions/repo/` is a per-repo carve-out that never enters the bundle
// files map, so it needs no entry here; the fleet composites under
// `.github/actions/fleet/` do.
export const ALWAYS_TRACKED_GITHUB_PREFIXES: readonly string[] = [
  '.github/actions/fleet/',
  '.github/workflows/',
]

/**
 * True when `relPath`, repo-relative, either separator, is part of the GitHub
 * CI surface a member must keep git-tracked even when thin — a workflow file or
 * a fleet composite action. `thinIgnoreEntries` gates on this so the untrack
 * set can never strand CI: GitHub reads both surfaces from the committed tree
 * before any fetch step runs, so a `git rm --cached` would break the member's
 * CI outright.
 */
export function isAlwaysTrackedGitHubSurface(relPath: string): boolean {
  const p = relPath.replaceAll('\\', '/')
  for (
    let i = 0, { length } = ALWAYS_TRACKED_GITHUB_PREFIXES;
    i < length;
    i += 1
  ) {
    if (p.startsWith(ALWAYS_TRACKED_GITHUB_PREFIXES[i]!)) {
      return true
    }
  }
  return false
}
