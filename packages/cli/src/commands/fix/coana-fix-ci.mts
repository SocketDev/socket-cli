import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

import { cleanupSocketFixPrs, getSocketFixPrs } from './pull-request.mts'
import { isGhsaFixed } from './ghsa-tracker.mts'
import { runGhsaFixLoop } from './coana-fix-pr-loop.mts'
import { GQL_PR_STATE_OPEN } from '../../constants/github.mts'
import { fetchGhsaDetails } from '../../util/git/github.mts'
import { spawnCoanaDlx } from '../../util/dlx/spawn.mjs'

import type { FixEnv } from './env-helpers.mts'
import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'
const logger = getDefaultLogger()

export type GhsaFixResult = {
  ghsaId: string
  fixed: boolean
  pullRequestLink?: string | undefined
  pullRequestNumber?: number | undefined
}

export async function runCiCoanaFix(
  fixConfig: FixConfig,
  context: {
    coanaSilenceArgs: string[]
    coanaStdio: 'ignore' | 'inherit'
    fixEnv: FixEnv
    scanFilepaths: string[]
    shouldDiscoverGhsaIds: boolean
    tarHash: string
  },
): Promise<CResult<{ fixedAll: boolean; ghsaDetails: GhsaFixResult[] }>> {
  const { coanaVersion, cwd, ecosystems, ghsas, prLimit, spinner } = fixConfig
  const {
    coanaSilenceArgs,
    coanaStdio,
    fixEnv,
    scanFilepaths,
    shouldDiscoverGhsaIds,
    tarHash,
  } = context

  const shouldOpenPrs = fixEnv.isCi && fixEnv.repoInfo

  // Adjust PR limit based on open Socket Fix PRs.
  let adjustedLimit = prLimit
  if (shouldOpenPrs && fixEnv.repoInfo) {
    try {
      const openPrs = await getSocketFixPrs(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        {
          states: GQL_PR_STATE_OPEN,
        },
      )
      const openPrCount = openPrs.length
      // Reduce limit by number of open PRs to avoid creating too many.
      adjustedLimit = Math.max(0, prLimit - openPrCount)
      if (openPrCount > 0) {
        debug(
          `prLimit: adjusted from ${prLimit} to ${adjustedLimit} (${openPrCount} open Socket Fix ${pluralize('PR', { count: openPrCount })}`,
        )
      }
    } catch (e) {
      debug('Failed to count open PRs, using original limit')
      debugDir(e)
    }
  }

  const shouldSpawnCoana = adjustedLimit > 0

  let ids: string[] | undefined

  // When shouldDiscoverGhsaIds is true, discover vulnerabilities using find-vulnerabilities command.
  // This gives us the GHSA IDs needed to create individual PRs in CI mode.
  if (shouldSpawnCoana && shouldDiscoverGhsaIds) {
    try {
      const discoverCResult = await spawnCoanaDlx(
        [
          'find-vulnerabilities',
          cwd,
          '--manifests-tar-hash',
          tarHash,
          ...(ecosystems.length ? ['--purl-types', ...ecosystems] : []),
        ],
        fixConfig.orgSlug,
        { coanaVersion, cwd, spinner },
        { stdio: 'pipe' },
      )

      if (discoverCResult.ok) {
        // Coana prints ghsaIds as json-formatted string on the final line of the output.
        const discoveredIds: string[] = []
        try {
          const lines = discoverCResult.data
            .trim()
            .split('\n')
            .filter(line => line.trim())
          const ghsaIdsRaw = lines.length > 0 ? lines[lines.length - 1] : ''
          if (ghsaIdsRaw?.trim()) {
            const parsed = JSON.parse(ghsaIdsRaw)
            if (!Array.isArray(parsed)) {
              throw new Error(
                `coana find-vulnerabilities returned non-array JSON on last line (got: ${typeof parsed}); expected an array of GHSA ID strings`,
              )
            }
            discoveredIds.push(...parsed)
          }
        } catch (e) {
          debug('Failed to parse GHSA IDs from find-vulnerabilities output')
          debugDir(e)
        }
        ids = discoveredIds.slice(0, adjustedLimit)
      }
    } catch (e) {
      debug('Failed to discover vulnerabilities')
      debugDir(e)
    }
  } else if (shouldSpawnCoana) {
    ids = ghsas.slice(0, adjustedLimit)
  }

  if (!ids?.length) {
    debug('miss: no GHSA IDs to process')
  }

  /* c8 ignore start -- defensive: shouldOpenPrs requires repoInfo truthy above, so reaching this branch with repoInfo undefined is unreachable. */
  if (!fixEnv.repoInfo) {
    debug('miss: no repo info detected')
  }
  /* c8 ignore stop */

  if (!ids?.length || !fixEnv.repoInfo) {
    spinner?.stop()
    return { ok: true, data: { fixedAll: false, ghsaDetails: [] } }
  }

  const displayIds =
    ids.length > 3
      ? `${ids.slice(0, 3).join(', ')} … and ${ids.length - 3} more`
      : joinAnd(ids)
  debug(`fetch: ${ids.length} GHSA details for ${displayIds}`)

  const ghsaDetails = await fetchGhsaDetails(ids)
  const scanBaseNames = new Set(scanFilepaths.map(p => path.basename(p)))

  debug(`found: ${ghsaDetails.size} GHSA details`)

  // Filter out already-fixed GHSAs to avoid duplicate work.
  const unprocessedIds: string[] = []
  for (let i = 0, { length } = ids; i < length; i += 1) {
    const ghsaId = ids[i]!
    const alreadyFixed = await isGhsaFixed(cwd, ghsaId)
    if (!alreadyFixed) {
      unprocessedIds.push(ghsaId)
    }
  }

  const skippedCount = ids.length - unprocessedIds.length
  if (skippedCount > 0) {
    logger.info(
      `Skipping ${skippedCount} already-fixed ${pluralize('GHSA', { count: skippedCount })}`,
    )
  }

  // Clean up stale and merged Socket Fix PRs before creating new ones.
  if (shouldOpenPrs && fixEnv.repoInfo) {
    logger.substep('Cleaning up stale and merged Socket Fix PRs…')

    for (let i = 0, { length } = unprocessedIds; i < length; i += 1) {
      const ghsaId = unprocessedIds[i]!
      try {
        const cleaned = await cleanupSocketFixPrs(
          fixEnv.repoInfo.owner,
          fixEnv.repoInfo.repo,
          ghsaId,
        )
        if (cleaned.length) {
          debug(`pr: cleaned ${cleaned.length} PRs for ${ghsaId}`)
        }
      } catch (e) {
        debug(`pr: cleanup failed for ${ghsaId}`)
        debugDir(e)
      }
    }
  }

  return await runGhsaFixLoop(fixConfig, {
    adjustedLimit,
    coanaSilenceArgs,
    coanaStdio,
    fixEnv,
    ghsaDetails,
    scanBaseNames,
    tarHash,
    unprocessedIds,
  })
}
