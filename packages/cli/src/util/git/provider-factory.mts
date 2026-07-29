import { debugDir } from '@socketsecurity/lib-stable/debug/output'

import { GitHubProvider } from './github-provider.mts'
import { GitLabProvider } from './gitlab-provider.mts'
import { spawnGit } from './spawn-git.mts'

import type { PrProvider } from './provider.mts'

/**
 * Creates a PR provider instance based on the git remote URL.
 *
 * Auto-detects GitHub vs GitLab based on the remote origin URL. Falls back to
 * GitHub for backward compatibility.
 */
export async function createPrProvider(): Promise<PrProvider> {
  const remoteUrl = await getGitRemoteUrl()

  // Check for GitLab.
  if (
    remoteUrl.includes('gitlab.com') ||
    process.env['GITLAB_HOST'] ||
    remoteUrl.includes('gitlab')
  ) {
    return new GitLabProvider()
  }

  // Default to GitHub, backward compatibility.
  return new GitHubProvider()
}

/**
 * Gets the git remote origin URL.
 *
 * Uses `git config` to read the remote.origin.url setting. Exported for testing
 * purposes.
 */
export async function getGitRemoteUrl(): Promise<string> {
  try {
    const result = await spawnGit(['config', '--get'], {
      operands: ['remote.origin.url'],
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.code === 0 && result.stdout) {
      return result.stdout.trim().toLowerCase()
    }
  } catch (e) {
    // Expected when there is no origin remote or no git repository.
    debugDir({ message: 'git config --get remote.origin.url failed', error: e })
  }

  return ''
}
