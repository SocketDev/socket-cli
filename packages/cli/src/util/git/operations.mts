/**
 * Git utilities for Socket CLI. Provides git operations for repository
 * management, branch handling, and commits.
 *
 * Branch Operations: - gitCheckoutBranch: Switch to branch - gitCreateBranch:
 * Create new local branch - gitDeleteBranch: Delete local branch -
 * gitDeleteRemoteBranch: Delete remote branch - gitPushBranch: Push branch to
 * remote with --force.
 *
 * Commit Operations: - gitCleanFdx: Remove untracked files - gitCommit: Stage
 * files and create commit - gitEnsureIdentity: Configure git user.name/email -
 * gitResetHard: Reset to branch/commit.
 *
 * Remote URL Parsing: - parseGitRemoteUrl: Extract owner/repo from SSH or HTTPS
 * URLs.
 *
 * Repository Information: - detectDefaultBranch: Find default branch
 * (main/master/develop/etc — inclusive-language: external-api) - getBaseBranch:
 * Determine base branch (respects GitHub Actions env) - getRepoInfo: Extract
 * owner/repo from git remote URL - gitBranch: Get current branch or commit
 * hash.
 */

// Git executable resolution extracted to keep this file under the
// 1000-line File-size cap. See git-path.mts.
export { getGitPath } from './git-path.mts'

// Branch operations extracted to keep this file under the 1000-line
// File-size cap. See git-branch-ops.mts.
export {
  detectDefaultBranch,
  getBaseBranch,
  gitCheckoutBranch,
  gitCreateBranch,
  gitDeleteBranch,
  gitDeleteRemoteBranch,
  gitLocalBranchExists,
  gitPushBranch,
  gitRemoteBranchExists,
} from './git-branch-ops.mts'

// Commit + working-tree operations extracted to keep this file under the
// 1000-line File-size cap. See git-commit-ops.mts.
export {
  gitCleanFdx,
  gitCommit,
  gitEnsureIdentity,
  gitResetAndClean,
  gitResetHard,
  type GitCreateAndPushBranchOptions,
} from './git-commit-ops.mts'

// Remote-repository info + URL parsing extracted to keep this file under
// the 1000-line File-size cap. See git-remote-info.mts.
export {
  getRepoInfo,
  getRepoName,
  getRepoOwner,
  gitBranch,
  gitUnstagedModifiedFiles,
  parseGitRemoteUrl,
  type RepoInfo,
} from './git-remote-info.mts'
