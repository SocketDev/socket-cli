/**
 * @fileoverview GitHub Actions environment variable getters.
 * Provides access to GitHub Actions CI/CD environment variables.
 */

import { getEnvValue } from '#env/rewire'

/**
 * GITHUB_API_URL environment variable.
 * GitHub API URL (e.g., https://api.github.com).
 */
export function getGithubApiUrl(): string | undefined {
  return getEnvValue('GITHUB_API_URL')
}

/**
 * GITHUB_BASE_REF environment variable.
 * GitHub pull request base branch.
 */
export function getGithubBaseRef(): string | undefined {
  return getEnvValue('GITHUB_BASE_REF')
}

/**
 * GITHUB_REF_NAME environment variable.
 * GitHub branch or tag name.
 */
export function getGithubRefName(): string | undefined {
  return getEnvValue('GITHUB_REF_NAME')
}

/**
 * GITHUB_REF_TYPE environment variable.
 * GitHub ref type (branch or tag).
 */
export function getGithubRefType(): string | undefined {
  return getEnvValue('GITHUB_REF_TYPE')
}

/**
 * GITHUB_REPOSITORY environment variable.
 * GitHub repository name in owner/repo format.
 */
export function getGithubRepository(): string | undefined {
  return getEnvValue('GITHUB_REPOSITORY')
}

/**
 * GITHUB_SERVER_URL environment variable.
 * GitHub server URL (e.g., https://github.com).
 */
export function getGithubServerUrl(): string | undefined {
  return getEnvValue('GITHUB_SERVER_URL')
}

/**
 * GITHUB_TOKEN environment variable.
 * GitHub authentication token for API access.
 */
export function getGithubToken(): string | undefined {
  return getEnvValue('GITHUB_TOKEN')
}

/**
 * GH_TOKEN environment variable.
 * Alternative GitHub authentication token for API access (used by GitHub CLI).
 */
export function getGhToken(): string | undefined {
  return getEnvValue('GH_TOKEN')
}
