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

import type { FixEnv } from './ci-environment.mts'
import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'
const logger = getDefaultLogger()

export type GhsaFixResult = {
  ghsaId: string
  fixed: boolean
  pullRequestLink?: string | undefined
  pullRequestNumber?: number | undefined
}

export async function discoverCoanaGhsaIds(
  fixConfig: FixConfig,
  config: {
    adjustedLimit: number
    shouldDiscoverGhsaIds: boolean
    tarHash: string
  },
): Promise<string[] | undefined> {
  const { adjustedLimit, shouldDiscoverGhsaIds, tarHash } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (adjustedLimit <= 0) {
    return undefined
  }
  if (!shouldDiscoverGhsaIds) {
    return fixConfig.ghsas.slice(0, adjustedLimit)
  }
  try {
    const result = await spawnCoanaDlx(
      [
        'find-vulnerabilities',
        fixConfig.cwd,
        '--manifests-tar-hash',
        tarHash,
        ...(fixConfig.ecosystems.length
          ? ['--purl-types', ...fixConfig.ecosystems]
          : []),
      ],
      {
        orgSlug: fixConfig.orgSlug,
        coanaVersion: fixConfig.coanaVersion,
        cwd: fixConfig.cwd,
        spinner: fixConfig.spinner,
      },
      { stdio: 'pipe' },
    )
    return result.ok
      ? parseDiscoveredGhsaIds(result.data).slice(0, adjustedLimit)
      : undefined
  } catch (e) {
    debug('Failed to discover vulnerabilities')
    debugDir(e)
    return undefined
  }
}

export async function getAdjustedPrLimit(
  fixEnv: FixEnv,
  prLimit: number,
): Promise<number> {
  if (!fixEnv.isCi || !fixEnv.repoInfo) {
    return prLimit
  }
  try {
    const openPrs = await getSocketFixPrs(
      fixEnv.repoInfo.owner,
      fixEnv.repoInfo.repo,
      { states: GQL_PR_STATE_OPEN },
    )
    const adjustedLimit = Math.max(0, prLimit - openPrs.length)
    if (openPrs.length > 0) {
      debug(
        `prLimit: adjusted from ${prLimit} to ${adjustedLimit} (${openPrs.length} open Socket Fix ${pluralize('PR', { count: openPrs.length })}`,
      )
    }
    return adjustedLimit
  } catch (e) {
    debug('Failed to count open PRs, using original limit')
    debugDir(e)
    return prLimit
  }
}

export function getGhsaIdSummary(ids: string[]): string {
  return ids.length > 3
    ? `${ids.slice(0, 3).join(', ')} … and ${ids.length - 3} more`
    : joinAnd(ids)
}

export async function getUnprocessedGhsaIds(
  cwd: string,
  ids: string[],
): Promise<string[]> {
  const unprocessedIds: string[] = []
  for (let i = 0, { length } = ids; i < length; i += 1) {
    const ghsaId = ids[i]!
    if (!(await isGhsaFixed(cwd, ghsaId))) {
      unprocessedIds.push(ghsaId)
    }
  }
  return unprocessedIds
}

export function parseDiscoveredGhsaIds(output: string): string[] {
  try {
    const lines = output
      .trim()
      .split(/\r?\n/)
      .filter(line => line.trim())
    const raw = lines.length > 0 ? lines[lines.length - 1] : ''
    if (!raw?.trim()) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new TypeError(
        `coana find-vulnerabilities returned non-array JSON on last line (got: ${typeof parsed}); expected an array of GHSA ID strings`,
      )
    }
    return parsed as string[]
  } catch (e) {
    debug('Failed to parse GHSA IDs from find-vulnerabilities output')
    debugDir(e)
    return []
  }
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
  const { cwd, prLimit, spinner } = fixConfig
  const {
    coanaSilenceArgs,
    coanaStdio,
    fixEnv,
    scanFilepaths,
    shouldDiscoverGhsaIds,
    tarHash,
  } = context

  const shouldOpenPrs = fixEnv.isCi && fixEnv.repoInfo

  const adjustedLimit = await getAdjustedPrLimit(fixEnv, prLimit)
  const ids = await discoverCoanaGhsaIds(fixConfig, {
    adjustedLimit,
    shouldDiscoverGhsaIds,
    tarHash,
  })

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

  const displayIds = getGhsaIdSummary(ids)
  debug(`fetch: ${ids.length} GHSA details for ${displayIds}`)

  const ghsaDetails = await fetchGhsaDetails(ids)
  const scanBaseNames = new Set(scanFilepaths.map(p => path.basename(p)))

  debug(`found: ${ghsaDetails.size} GHSA details`)

  // Filter out already-fixed GHSAs to avoid duplicate work.
  const unprocessedIds = await getUnprocessedGhsaIds(cwd, ids)

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
