import { fetchReportData } from './fetch-report-data'
import { outputScanReport } from './output-scan-report'

export async function handleScanReport({
  filePath,
  fold,
  includeLicensePolicy,
  includeSecurityPolicy,
  orgSlug,
  outputKind,
  reportLevel,
  scanId,
  short
}: {
  orgSlug: string
  scanId: string
  includeLicensePolicy: boolean
  includeSecurityPolicy: boolean
  outputKind: 'json' | 'markdown' | 'text'
  filePath: string
  fold: 'pkg' | 'version' | 'file' | 'none'
  reportLevel: 'defer' | 'ignore' | 'monitor' | 'warn' | 'error'
  short: boolean
}): Promise<void> {
  if (!includeLicensePolicy && !includeSecurityPolicy) {
    process.exitCode = 1
    return // caller should assert
  }

  const {
    // licensePolicy,
    ok,
    scan,
    securityPolicy
  } = await fetchReportData(
    orgSlug,
    scanId,
    // includeLicensePolicy
    includeSecurityPolicy
  )
  if (!ok) {
    return
  }

  await outputScanReport(scan, securityPolicy, {
    filePath,
    fold,
    scanId: scanId,
    includeLicensePolicy,
    includeSecurityPolicy,
    orgSlug,
    outputKind,
    reportLevel,
    short
  })
}
