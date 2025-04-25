import { fetchReportData } from './fetch-report-data'
import { outputScanReport } from './output-scan-report'

import type { OutputKind } from '../../types'

export async function handleScanReport({
  filePath,
  fold,
  includeLicensePolicy,
  orgSlug,
  outputKind,
  reportLevel,
  scanId,
  short
}: {
  orgSlug: string
  scanId: string
  includeLicensePolicy: boolean
  outputKind: OutputKind
  filePath: string
  fold: 'pkg' | 'version' | 'file' | 'none'
  reportLevel: 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
  short: boolean
}): Promise<void> {
  const { ok, scan, securityPolicy } = await fetchReportData(
    orgSlug,
    scanId,
    includeLicensePolicy
  )
  if (!ok) {
    return
  }

  await outputScanReport(scan, securityPolicy, {
    filePath,
    fold,
    scanId: scanId,
    includeLicensePolicy,
    orgSlug,
    outputKind,
    reportLevel,
    short
  })
}
