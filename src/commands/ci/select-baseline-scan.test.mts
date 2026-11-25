import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  findBaselineScan,
  selectBaselineScan,
} from './select-baseline-scan.mts'
import { fetchOrgFullScanList } from '../scan/fetch-list-scans.mts'

vi.mock('../scan/fetch-list-scans.mts', () => ({
  fetchOrgFullScanList: vi.fn(),
}))

const scan = {
  api_url: null,
  created_at: '2026-01-01T00:00:00Z',
  html_report_url: 'https://socket.dev/report',
  id: 'scan-base',
  integration_repo_url: null,
  integration_type: null,
  organization_id: 'org-id',
  organization_slug: 'test-org',
  repo: 'test-repo',
  repository_id: 'repo-id',
  repository_slug: 'test-repo',
  updated_at: '2026-01-01T00:00:00Z',
  commit_hash: 'base-sha',
  branch: 'main',
}

describe('selectBaselineScan', () => {
  beforeEach(() => {
    vi.mocked(fetchOrgFullScanList).mockReset()
  })

  it('selects the exact commit when the scan list includes nearby scans', () => {
    expect(
      findBaselineScan(
        [{ ...scan, id: 'newer', commit_hash: 'newer-sha' }, scan],
        'base-sha',
      ),
    ).toEqual(scan)
  })

  it('selects an exact commit scan from the matching repo and branch query', async () => {
    vi.mocked(fetchOrgFullScanList).mockResolvedValue({
      ok: true,
      data: { results: [scan] },
    })
    await expect(
      selectBaselineScan({
        branch: 'main',
        commitHash: 'base-sha',
        orgSlug: 'test-org',
        repo: 'test-repo',
      }),
    ).resolves.toEqual({ ok: true, data: scan })
    expect(fetchOrgFullScanList).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'main',
        commitHash: 'base-sha',
        perPage: 1,
        repo: 'test-repo',
      }),
    )
  })

  it('fails without a commit SHA', async () => {
    await expect(
      selectBaselineScan({
        branch: 'main',
        commitHash: '',
        orgSlug: 'test-org',
        repo: 'test-repo',
      }),
    ).resolves.toMatchObject({ ok: false })
    expect(fetchOrgFullScanList).not.toHaveBeenCalled()
  })

  it('fails closed when the exact commit has no scan', async () => {
    vi.mocked(fetchOrgFullScanList).mockResolvedValue({
      ok: true,
      data: { results: [scan] },
    })
    await expect(
      selectBaselineScan({
        branch: 'main',
        commitHash: 'unknown-sha',
        orgSlug: 'test-org',
        repo: 'test-repo',
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: 'No matching PR scan baseline found',
    })
  })
})
