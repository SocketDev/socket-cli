import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import {
  CVE_FORMAT_REGEXP,
  GHSA_FORMAT_REGEXP,
  convertCveToGhsa,
} from './cve-to-ghsa.mts'
import { convertPurlToGhsas } from './purl-to-ghsa.mts'

type ResolveAdvisoryIdsOptions = {
  silence?: boolean | undefined
}

export type ResolvedAdvisoryIds = {
  errors: string[]
  ghsas: string[]
}

/**
 * Converts mixed CVE/GHSA/PURL IDs to GHSA IDs, collecting one error for each
 * ID that is malformed or cannot be converted.
 */
export async function resolveAdvisoryIds(
  ids: readonly string[],
  options?: ResolveAdvisoryIdsOptions | undefined,
): Promise<ResolvedAdvisoryIds> {
  const { silence = false } = {
    __proto__: null,
    ...options,
  } as ResolveAdvisoryIdsOptions

  const ghsas: string[] = []
  const errors: string[] = []

  for (const id of ids) {
    const trimmedId = id.trim()

    if (trimmedId.startsWith('GHSA-')) {
      // Already a GHSA ID, validate format
      if (GHSA_FORMAT_REGEXP.test(trimmedId)) {
        ghsas.push(trimmedId)
      } else {
        errors.push(`Invalid GHSA format: ${trimmedId}`)
      }
    } else if (trimmedId.startsWith('CVE-')) {
      // Convert CVE to GHSA
      if (!CVE_FORMAT_REGEXP.test(trimmedId)) {
        errors.push(`Invalid CVE format: ${trimmedId}`)
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const conversionResult = await convertCveToGhsa(trimmedId)
      if (conversionResult.ok) {
        ghsas.push(conversionResult.data)
        if (!silence) {
          logger.info(`Converted ${trimmedId} to ${conversionResult.data}`)
        }
      } else {
        errors.push(`${trimmedId}: ${conversionResult.message}`)
      }
    } else if (trimmedId.startsWith('pkg:')) {
      // Convert PURL to GHSAs.
      // eslint-disable-next-line no-await-in-loop
      const conversionResult = await convertPurlToGhsas(trimmedId)
      if (conversionResult.ok && conversionResult.data.length) {
        ghsas.push(...conversionResult.data)
        if (!silence) {
          logger.info(
            `Converted ${trimmedId} to ${conversionResult.data.length} GHSA(s): ${joinAnd(conversionResult.data)}`,
          )
        }
      } else {
        errors.push(
          `${trimmedId}: ${conversionResult.message || 'No GHSAs found'}`,
        )
      }
    } else {
      // Neither CVE, GHSA, nor PURL, skip
      errors.push(
        `Unsupported ID format (expected CVE, GHSA, or PURL): ${trimmedId}`,
      )
    }
  }

  return { errors, ghsas }
}
