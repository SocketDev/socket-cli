import { fetchScanData } from './fetch-report-data.mts'
import { outputScanReport } from './output-scan-report.mts'

import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type { OutputKind } from '../../types.mts'

export type HandleScanReportConfig = {
  orgSlug: string
  scanId: string
  includeLicensePolicy: boolean
  outputKind: OutputKind
  filepath: string
  fold: FOLD_SETTING
  reportLevel: REPORT_LEVEL
  short: boolean
}

export async function handleScanReport({
  filepath,
  fold,
  includeLicensePolicy,
  orgSlug,
  outputKind,
  reportLevel,
  scanId,
  short,
}: HandleScanReportConfig): Promise<void> {
  const scanDataCResult = await fetchScanData(orgSlug, scanId, {
    includeLicensePolicy,
  })

  await outputScanReport(scanDataCResult, {
    filepath,
    fold,
    scanId: scanId,
    includeLicensePolicy,
    orgSlug,
    outputKind,
    reportLevel,
    short,
  })
}
