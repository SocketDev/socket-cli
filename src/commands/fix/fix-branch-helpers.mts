import { debugFn } from '@socketsecurity/registry/lib/debug'

import {
  getSocketBranchFullNameComponent,
  getSocketBranchPurlTypeComponent,
} from './git.mts'
import { getPurlObject } from '../../utils/purl.mts'

import type { CiEnv } from './fix-env-helpers.mts'
import type { SocketBranchParseResult } from './git.mts'
import type { PrMatch } from './open-pr.mts'

export function getActiveBranchesForPackage(
  ciEnv: CiEnv | null | undefined,
  partialPurl: string,
  openPrs: PrMatch[],
): SocketBranchParseResult[] {
  if (!ciEnv) {
    return []
  }

  const partialPurlObj = getPurlObject(partialPurl)
  const activeBranches: SocketBranchParseResult[] = []
  const branchFullName = getSocketBranchFullNameComponent(partialPurlObj)
  const branchPurlType = getSocketBranchPurlTypeComponent(partialPurlObj)

  for (const pr of openPrs) {
    const parsedBranch = ciEnv.branchParser(pr.headRefName)
    if (
      branchPurlType === parsedBranch?.type &&
      branchFullName === parsedBranch?.fullName
    ) {
      activeBranches.push(parsedBranch)
    }
  }

  if (activeBranches.length) {
    debugFn(`found: ${activeBranches.length} active branches\n`, activeBranches)
  } else if (openPrs.length) {
    debugFn('miss: 0 active branches found')
  }

  return activeBranches
}
