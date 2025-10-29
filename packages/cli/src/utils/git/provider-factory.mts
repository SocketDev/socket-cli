import { spawnSync } from 'node:child_process'

import type { PrProvider } from './provider.mts'

/**
 * Creates a PR provider instance based on the git remote URL.
 *
 * Auto-detects GitHub vs GitLab based on the remote origin URL.
 * Falls back to GitHub for backward compatibility.
 */
export function createPrProvider(): PrProvider {
  const remoteUrl = getGitRemoteUrl()

  // Check for GitLab.
  if (
    remoteUrl.includes('gitlab.com') ||
    process.env['GITLAB_HOST'] ||
    remoteUrl.includes('gitlab')
  ) {
    // Lazy load to avoid importing GitLab dependency if not needed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GitLabProvider } = require('./gitlab-provider.mts')
    return new GitLabProvider()
  }

  // Default to GitHub (backward compatibility).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GitHubProvider } = require('./github-provider.mts')
  return new GitHubProvider()
}

/**
 * Gets the git remote origin URL.
 *
 * Uses `git config` to read the remote.origin.url setting.
 */
function getGitRemoteUrl(): string {
  try {
    const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim().toLowerCase()
    }
  } catch {
    // Ignore errors - will fall back to GitHub.
  }

  return ''
}
