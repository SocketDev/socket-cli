import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'

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

  const activeBranches: SocketBranchParseResult[] = []
  const partialPurlObj = getPurlObject(partialPurl)
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

  if (isDebug('notice')) {
    const fullName = resolvePackageName(partialPurlObj)
    if (activeBranches.length) {
      debugFn(
        'notice',
        `found: ${activeBranches.length} active branches for ${fullName}\n`,
        activeBranches,
      )
    } else if (openPrs.length) {
      debugFn('notice', `miss: 0 active branches found for ${fullName}`)
    }
  }

  return activeBranches
}
