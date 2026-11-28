import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectCiPullRequestContext } from './detect-ci-pull-request-context.mts'

const githubEnvironmentKeys = [
  'GITHUB_BASE_REF',
  'GITHUB_BASE_SHA',
  'GITHUB_EVENT_PATH',
  'GITHUB_REF',
] as const

let originalGithubEnvironment: Map<string, string | undefined>

describe('detectCiPullRequestContext', () => {
  beforeEach(() => {
    originalGithubEnvironment = new Map(
      githubEnvironmentKeys.map(key => [key, process.env[key]]),
    )
    for (const key of githubEnvironmentKeys) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of originalGithubEnvironment) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('derives the number from a pull request merge ref', async () => {
    process.env['GITHUB_REF'] = 'refs/pull/482/merge'
    await expect(detectCiPullRequestContext()).resolves.toEqual({
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 482,
      provider: 'github',
    })
  })

  it('derives the number from a pull request head ref', async () => {
    process.env['GITHUB_REF'] = 'refs/pull/482/head'
    await expect(detectCiPullRequestContext()).resolves.toEqual({
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 482,
      provider: 'github',
    })
  })

  it('returns 0 for a branch push', async () => {
    process.env['GITHUB_REF'] = 'refs/heads/feature-branch'
    await expect(detectCiPullRequestContext()).resolves.toEqual({
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 0,
      provider: undefined,
    })
  })

  it('returns 0 for a tag push', async () => {
    process.env['GITHUB_REF'] = 'refs/tags/v1.2.3'
    await expect(detectCiPullRequestContext()).resolves.toEqual({
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 0,
      provider: undefined,
    })
  })

  it('returns 0 when GITHUB_REF is not a numbered pull ref', async () => {
    process.env['GITHUB_REF'] = 'refs/pull/not-a-number/merge'
    await expect(detectCiPullRequestContext()).resolves.toEqual({
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 0,
      provider: undefined,
    })
  })

  it('returns 0 outside GitHub Actions', async () => {
    await expect(detectCiPullRequestContext()).resolves.toEqual({
      baseBranch: undefined,
      baseCommitHash: undefined,
      number: 0,
      provider: undefined,
    })
  })
})
