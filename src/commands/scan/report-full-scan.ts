import fs from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'

import { fetchReportData } from './fetch-report-data'
import { generateReport } from './generate-report'
import { mapToObject } from '../../utils/map-to-object'

export async function reportFullScan({
  filePath,
  fold,
  fullScanId,
  includeLicensePolicy,
  includeSecurityPolicy,
  orgSlug,
  outputKind,
  reportLevel
}: {
  orgSlug: string
  fullScanId: string
  includeLicensePolicy: boolean
  includeSecurityPolicy: boolean
  outputKind: 'json' | 'markdown' | 'text'
  filePath: string
  fold: 'pkg' | 'version' | 'file' | 'none'
  reportLevel: 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
}): Promise<void> {
  logger.error(
    'output:',
    outputKind,
    ', file:',
    filePath,
    ', fold:',
    fold,
    ', reportLevel:',
    reportLevel
  )
  if (!includeLicensePolicy && !includeSecurityPolicy) {
    return // caller should assert
  }

  const {
    // licensePolicy,
    ok,
    scan,
    securityPolicy
  } = await fetchReportData(
    orgSlug,
    fullScanId,
    includeLicensePolicy
    // includeSecurityPolicy
  )

  if (!ok) {
    return
  }

  const report = generateReport(
    scan,
    undefined, // licensePolicy,
    securityPolicy,
    {
      fold,
      reportLevel
    }
  )

  if (outputKind === 'json') {
    const obj = mapToObject(report.alerts)

    const json = JSON.stringify(obj, null, 2)

    if (filePath && filePath !== '-') {
      return await fs.writeFile(filePath, json)
    }

    logger.log(json)
    return
  }

  logger.dir(report, { depth: null })
}
