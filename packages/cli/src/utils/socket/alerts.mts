/**
 * Alerts map utilities for Socket CLI.
 * Manages security alerts and vulnerability mappings for packages.
 *
 * Key Functions:
 * - getAlertsMapFromPnpmLockfile: Extract alerts from pnpm lockfile
 * - getAlertsMapFromPurls: Get alerts for specific package URLs
 * - processAlertsApiResponse: Process API response into alerts map
 *
 * Alert Processing:
 * - Filters alerts based on socket.yml configuration
 * - Maps package URLs to security vulnerabilities
 * - Supports batch processing for performance
 *
 * Integration:
 * - Works with pnpm lockfiles for dependency scanning
 * - Uses Socket API for vulnerability data
 * - Respects filter configurations from socket.yml
 */

import { arrayUnique } from '@socketsecurity/lib/arrays'
import { debugDir } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getOwn } from '@socketsecurity/lib/objects'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import { findSocketYmlSync } from '../config.mts'
import { extractPurlsFromPnpmLockfile } from '../pnpm/lockfile.mts'
import { addArtifactToAlertsMap } from '../socket/package-alert.mts'
import { getPublicApiToken, setupSdk } from '../socket/sdk.mjs'
import { toFilterConfig } from '../validation/filter-config.mts'

import type { CompactSocketArtifact } from '../alert/artifact.mts'
import type { AlertFilter, AlertsByPurl } from '../socket/package-alert.mts'
import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { Spinner } from '@socketsecurity/lib/spinner'

export type GetAlertsMapFromPnpmLockfileOptions = {
  apiToken?: string | undefined
  consolidate?: boolean | undefined
  filter?: AlertFilter | undefined
  overrides?: { [key: string]: string } | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromPnpmLockfile(
  lockfile: LockfileObject,
  options?: GetAlertsMapFromPnpmLockfileOptions | undefined,
): Promise<AlertsByPurl> {
  const purls = await extractPurlsFromPnpmLockfile(lockfile)
  return await getAlertsMapFromPurls(purls, {
    overrides: lockfile.overrides,
    ...options,
  })
}

export type GetAlertsMapFromPurlsOptions = {
  apiToken?: string | undefined
  consolidate?: boolean | undefined
  filter?: AlertFilter | undefined
  onlyFixable?: boolean | undefined
  overrides?: { [key: string]: string } | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromPurls(
  purls: string[] | readonly string[],
  options?: GetAlertsMapFromPurlsOptions | undefined,
): Promise<AlertsByPurl> {
  const uniqPurls = arrayUnique(purls)
  debugDir('silly', { purls: uniqPurls })

  let { length: remaining } = uniqPurls
  const alertsByPurl: AlertsByPurl = new Map()

  if (!remaining) {
    return alertsByPurl
  }

  const opts = {
    __proto__: null,
    consolidate: false,
    nothrow: false,
    ...options,
    filter: toFilterConfig(getOwn(options, 'filter')),
  } as GetAlertsMapFromPurlsOptions & { filter: AlertFilter }

  if (opts.onlyFixable) {
    opts.filter.fixable = true
  }

  const { apiToken = getPublicApiToken(), spinner } = opts

  const getText = () => `Looking up data for ${remaining} packages`

  spinner?.start(getText())

  const sockSdkCResult = await setupSdk({ apiToken })
  if (!sockSdkCResult.ok) {
    spinner?.stop()
    throw new Error('Auth error: Run `socket login` first.')
  }
  const sockSdk = sockSdkCResult.data
  const socketYmlResult = findSocketYmlSync()
  const socketYml =
    socketYmlResult.ok && socketYmlResult.data
      ? socketYmlResult.data.parsed
      : undefined

  const alertsMapOptions = {
    consolidate: opts.consolidate,
    filter: opts.filter,
    overrides: opts.overrides,
    socketYml,
    spinner,
  }

  try {
    for await (const batchResult of sockSdk.batchPackageStream(
      {
        components: uniqPurls.map(purl => ({ purl })),
      },
      {
        queryParams: {
          alerts: 'true',
          compact: 'true',
          ...(opts.onlyFixable ? { fixable: 'true ' } : {}),
          ...(Array.isArray(opts.filter.actions)
            ? { actions: opts.filter.actions.join(',') }
            : {}),
        },
      },
    )) {
      if (batchResult.success) {
        const artifact = batchResult.data as CompactSocketArtifact
        await addArtifactToAlertsMap(artifact, alertsByPurl, alertsMapOptions)
      } else if (!opts.nothrow) {
        spinner?.stop()
        if (isNonEmptyString(batchResult.error)) {
          throw new Error(batchResult.error)
        }
        const statusCode = batchResult.status ?? 'unknown'
        throw new Error(
          `Socket API server error (${statusCode}): No status message`,
        )
      } else {
        spinner?.stop()
        const logger = getDefaultLogger()
        logger.fail(
          `Received a ${batchResult.status} response from Socket API which we consider a permanent failure:`,
          batchResult.error,
          batchResult.cause ? `( ${batchResult.cause} )` : '',
        )
        debugDir('inspect', { batchResult })
        break
      }
      remaining -= 1
      if (remaining > 0) {
        spinner?.start(getText())
      }
    }
  } catch (e) {
    spinner?.stop()
    throw e
  }

  spinner?.stop()

  return alertsByPurl
}
