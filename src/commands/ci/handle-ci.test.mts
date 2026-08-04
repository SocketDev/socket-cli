import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectCiPullRequestNumber } from './handle-ci.mts'

let originalGithubRef: string | undefined

describe('detectCiPullRequestNumber', () => {
  beforeEach(() => {
    originalGithubRef = process.env['GITHUB_REF']
    delete process.env['GITHUB_REF']
  })

  afterEach(() => {
    if (originalGithubRef === undefined) {
      delete process.env['GITHUB_REF']
    } else {
      process.env['GITHUB_REF'] = originalGithubRef
    }
  })

  it('derives the number from a pull request merge ref', () => {
    process.env['GITHUB_REF'] = 'refs/pull/482/merge'
    expect(detectCiPullRequestNumber()).toBe(482)
  })

  it('derives the number from a pull request head ref', () => {
    process.env['GITHUB_REF'] = 'refs/pull/482/head'
    expect(detectCiPullRequestNumber()).toBe(482)
  })

  it('returns 0 for a branch push', () => {
    process.env['GITHUB_REF'] = 'refs/heads/feature-branch'
    expect(detectCiPullRequestNumber()).toBe(0)
  })

  it('returns 0 for a tag push', () => {
    process.env['GITHUB_REF'] = 'refs/tags/v1.2.3'
    expect(detectCiPullRequestNumber()).toBe(0)
  })

  it('returns 0 when GITHUB_REF is not a numbered pull ref', () => {
    process.env['GITHUB_REF'] = 'refs/pull/not-a-number/merge'
    expect(detectCiPullRequestNumber()).toBe(0)
  })

  it('returns 0 outside GitHub Actions', () => {
    expect(detectCiPullRequestNumber()).toBe(0)
  })
})
