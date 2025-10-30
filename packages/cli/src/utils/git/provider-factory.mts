import { spawnSync } from '@socketsecurity/lib/spawn'

import type { PrProvider } from './provider.mts'

/**
 * Creates a PR provider instance based on the git remote URL.
 *
 * Auto-detects GitHub vs GitLab based on the remote origin URL.
 * Falls back to GitHub for backward compatibility.
 */
export function createPrProvider(): PrProvider {
  const remoteUrl = getGitRemoteUrlSync()

  // Check for GitLab.
  if (
    remoteUrl.includes('gitlab.com') ||
    process.env['GITLAB_HOST'] ||
    remoteUrl.includes('gitlab')
  ) {
    // Lazy load to avoid importing GitLab dependency if not needed.

    const { GitLabProvider } = require('./gitlab-provider.mts')
    return new GitLabProvider()
  }

  // Default to GitHub (backward compatibility).

  const { GitHubProvider } = require('./github-provider.mts')
  return new GitHubProvider()
}

/**
 * Gets the git remote origin URL synchronously.
 *
 * Uses `git config` to read the remote.origin.url setting.
 * Exported for testing purposes.
 */
export function getGitRemoteUrlSync(): string {
  try {
    const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status === 0 && result.stdout) {
      const remoteUrl =
        typeof result.stdout === 'string'
          ? result.stdout
          : result.stdout.toString('utf8')
      return remoteUrl.trim().toLowerCase()
    }
  } catch {
    // Ignore errors - will fall back to GitHub.
  }

  return ''
}
