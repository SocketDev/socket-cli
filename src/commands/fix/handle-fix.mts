import { logger } from '@socketsecurity/registry/lib/logger'

import { coanaFix } from './coana-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { convertCveToGhsa } from '../../utils/cve-to-ghsa.mts'
import { convertPurlToGhsas } from '../../utils/purl-to-ghsa.mts'

import type { FixConfig } from './types.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

const GHSA_FORMAT_REGEXP = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
const CVE_FORMAT_REGEXP = /^CVE-\d{4}-\d{4,}$/

export type HandleFixConfig = Remap<
  FixConfig & {
    ghsas: string[]
    orgSlug: string
    outputKind: OutputKind
    unknownFlags: string[]
  }
>

/**
 * Converts mixed CVE/GHSA/PURL IDs to GHSA IDs only.
 * Filters out invalid IDs and logs conversion results.
 */
export async function convertIdsToGhsas(ids: string[]): Promise<string[]> {
  const validGhsas: string[] = []
  const errors: string[] = []

  for (const id of ids) {
    const trimmedId = id.trim()

    if (trimmedId.startsWith('GHSA-')) {
      // Already a GHSA ID, validate format
      if (GHSA_FORMAT_REGEXP.test(trimmedId)) {
        validGhsas.push(trimmedId)
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
        validGhsas.push(conversionResult.data)
        logger.info(`Converted ${trimmedId} to ${conversionResult.data}`)
      } else {
        errors.push(`${trimmedId}: ${conversionResult.message}`)
      }
    } else if (trimmedId.startsWith('pkg:')) {
      // Convert PURL to GHSAs
      // eslint-disable-next-line no-await-in-loop
      const conversionResult = await convertPurlToGhsas(trimmedId)
      if (conversionResult.ok && conversionResult.data.length) {
        validGhsas.push(...conversionResult.data)
        logger.info(
          `Converted ${trimmedId} to ${conversionResult.data.length} GHSA(s): ${conversionResult.data.join(', ')}`,
        )
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

  if (errors.length) {
    logger.warn(
      `Skipped ${errors.length} invalid IDs:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    )
  }

  return validGhsas
}

export async function handleFix({
  autopilot,
  cwd,
  ghsas,
  limit,
  minSatisfying,
  orgSlug,
  outputKind,
  prCheck,
  rangeStyle,
  spinner,
  unknownFlags,
}: HandleFixConfig) {
  await outputFixResult(
    await coanaFix({
      autopilot,
      cwd,
      // Convert mixed CVE/GHSA/PURL inputs to GHSA IDs only
      ghsas: await convertIdsToGhsas(ghsas),
      limit,
      minSatisfying,
      orgSlug,
      prCheck,
      rangeStyle,
      spinner,
      unknownFlags,
    }),
    outputKind,
  )
}
