import { describe, expect, it, vi } from 'vitest'

import {
  PR_OVERVIEW_COMMENT_MARKER,
  PR_SECURITY_COMMENT_MARKER,
  publishPullRequestComments,
  renderPullRequestOverview,
  renderPullRequestSecurity,
} from './publish-pr-comments.mts'
import { upsertPullRequestComment } from '../../utils/github.mts'

import type { ScanReport } from '../scan/generate-report.mts'

vi.mock('../../utils/github.mts', () => ({
  upsertPullRequestComment: vi.fn(),
}))

const config = {
  disableOverview: false,
  disableSecurity: false,
  overviewBody: 'Dependency summary',
  owner: 'SocketDev',
  pullRequest: 42,
  repo: 'socket-cli',
  securityBody: 'Security findings',
}

const report = {
  alerts: new Map([
    [
      'npm',
      new Map([
        [
          'left-pad',
          new Map([
            [
              '1.0.0',
              {
                type: 'CVE-2026-1234',
                policy: 'error',
                manifest: ['package-lock.json'],
                url: 'https://socket.dev/alert',
              },
            ],
          ]),
        ],
      ]),
    ],
  ]),
  healthy: false,
  options: { fold: 'version', reportLevel: 'error' },
  orgSlug: 'test-org',
  scanId: 'scan-123',
} as unknown as ScanReport

describe('publishPullRequestComments', () => {
  it('renders alert leaves and counts findings rather than ecosystems', () => {
    expect(renderPullRequestSecurity(report)).toContain(
      'npm / left-pad / 1.0.0: CVE-2026-1234 (error)',
    )
    expect(renderPullRequestOverview(report)).toContain('found 1 policy alert.')
  })

  it('publishes separate marked overview and security comments', async () => {
    await publishPullRequestComments(config)
    expect(upsertPullRequestComment).toHaveBeenNthCalledWith(1, {
      body: `${PR_OVERVIEW_COMMENT_MARKER}\nDependency summary`,
      marker: PR_OVERVIEW_COMMENT_MARKER,
      owner: 'SocketDev',
      pullRequest: 42,
      repo: 'socket-cli',
    })
    expect(upsertPullRequestComment).toHaveBeenNthCalledWith(2, {
      body: `${PR_SECURITY_COMMENT_MARKER}\nSecurity findings`,
      marker: PR_SECURITY_COMMENT_MARKER,
      owner: 'SocketDev',
      pullRequest: 42,
      repo: 'socket-cli',
    })
  })

  it('suppresses each comment type independently', async () => {
    await publishPullRequestComments({
      ...config,
      disableOverview: true,
      overviewBody: '',
    })
    expect(upsertPullRequestComment).toHaveBeenCalledTimes(1)
    expect(upsertPullRequestComment).toHaveBeenCalledWith(
      expect.objectContaining({ marker: PR_SECURITY_COMMENT_MARKER }),
    )
  })

  it('skips empty output when no prior comment can be located', async () => {
    await publishPullRequestComments({
      ...config,
      overviewBody: '',
      securityBody: '',
    })
    expect(upsertPullRequestComment).not.toHaveBeenCalled()
  })
})
