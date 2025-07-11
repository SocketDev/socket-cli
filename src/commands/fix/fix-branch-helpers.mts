import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'

import {
  genericSocketBranchParser,
  getSocketBranchFullNameComponent,
  getSocketBranchPurlTypeComponent,
} from './socket-git.mts'
import { getPurlObject } from '../../utils/purl.mts'

import type { FixEnv } from './fix-env-helpers.mts'
import type { PrMatch } from './pull-request.mts'

export function getPrsForPurl(
  fixEnv: FixEnv | null | undefined,
  partialPurl: string,
): PrMatch[] {
  if (!fixEnv) {
    return []
  }

  const prs: PrMatch[] = []
  const partialPurlObj = getPurlObject(partialPurl)
  const branchFullName = getSocketBranchFullNameComponent(partialPurlObj)
  const branchPurlType = getSocketBranchPurlTypeComponent(partialPurlObj)

  for (const pr of fixEnv.prs) {
    const parsedBranch = genericSocketBranchParser(pr.headRefName)
    if (
      branchPurlType === parsedBranch?.type &&
      branchFullName === parsedBranch?.fullName
    ) {
      prs.push(pr)
    }
  }

  if (isDebug('notice,inspect')) {
    const fullName = resolvePackageName(partialPurlObj)
    if (prs.length) {
      debugFn('notice', `found: ${prs.length} PRs for ${fullName}`)
      debugDir('inspect', { prs })
    } else if (fixEnv.prs.length) {
      debugFn('notice', `miss: 0 PRs found for ${fullName}`)
    }
  }

  return prs
}
