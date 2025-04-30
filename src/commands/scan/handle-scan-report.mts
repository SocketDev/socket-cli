import { fetchReportData } from './fetch-report-data.mts'
import { outputScanReport } from './output-scan-report.mts'

import type { OutputKind } from '../../types.mts'

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
  const result = await fetchReportData(orgSlug, scanId, includeLicensePolicy)

  await outputScanReport(result, {
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
