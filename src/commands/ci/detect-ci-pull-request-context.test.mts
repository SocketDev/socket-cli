import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { detectCiPullRequestContext } from './detect-ci-pull-request-context.mts'

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('GITHUB_REF', '')
  vi.stubEnv('CI_MERGE_REQUEST_IID', '')
  vi.stubEnv('SYSTEM_PULLREQUEST_PULLREQUESTNUMBER', '')
  vi.stubEnv('SYSTEM_PULLREQUEST_PULLREQUESTID', '')
})

describe('detectCiPullRequestContext', () => {
  it('detects GitHub pull requests', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/pull/42/merge')
    await expect(detectCiPullRequestContext()).resolves.toMatchObject({
      number: 42,
      provider: 'github',
    })
  })

  it('detects GitLab merge requests', async () => {
    vi.stubEnv('CI_MERGE_REQUEST_IID', '17')
    await expect(detectCiPullRequestContext()).resolves.toMatchObject({
      number: 17,
      provider: 'gitlab',
    })
  })

  it('detects Azure pull requests', async () => {
    vi.stubEnv('SYSTEM_PULLREQUEST_PULLREQUESTNUMBER', '9')
    await expect(detectCiPullRequestContext()).resolves.toMatchObject({
      number: 9,
      provider: 'azure',
    })
  })

  it('ignores zero and malformed provider values', async () => {
    vi.stubEnv('CI_MERGE_REQUEST_IID', '0')
    vi.stubEnv('SYSTEM_PULLREQUEST_PULLREQUESTID', 'nope')
    await expect(detectCiPullRequestContext()).resolves.toMatchObject({
      number: 0,
      provider: undefined,
    })
  })
})
