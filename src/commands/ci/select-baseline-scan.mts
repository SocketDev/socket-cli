import { fetchOrgFullScanList } from '../scan/fetch-list-scans.mts'

import type { CResult } from '../../types.mts'
import type { FullScanItem } from '@socketsecurity/sdk'

export type SelectBaselineScanConfig = {
  branch: string
  commitHash: string
  orgSlug: string
  repo: string
}

export function findBaselineScan(
  scans: FullScanItem[],
  commitHash: string,
): FullScanItem | undefined {
  return scans.find(scan => scan.commit_hash === commitHash)
}

export async function selectBaselineScan({
  branch,
  commitHash,
  orgSlug,
  repo,
}: SelectBaselineScanConfig): Promise<CResult<FullScanItem>> {
  if (!commitHash) {
    return {
      ok: false,
      message: 'Cannot select PR scan baseline',
      cause: 'The CI checkout does not provide a commit SHA.',
    }
  }

  const scansCResult = await fetchOrgFullScanList({
    branch,
    commitHash,
    direction: 'desc',
    from_time: '',
    orgSlug,
    page: 1,
    perPage: 1,
    repo,
    sort: 'created_at',
  })
  if (!scansCResult.ok) {
    return scansCResult
  }

  const scan = findBaselineScan(scansCResult.data.results, commitHash)
  return scan
    ? { ok: true, data: scan }
    : {
        ok: false,
        message: 'No matching PR scan baseline found',
        cause: `No scan exists for commit ${commitHash} on ${repo}/${branch}. Run a scan for the base commit first.`,
      }
}
