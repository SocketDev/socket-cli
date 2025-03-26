import fs from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'

import { generateReport } from './generate-report'
import constants from '../../constants'
import { mapToObject } from '../../utils/map-to-object'
import { mdTable } from '../../utils/markdown'
import { walkNestedMap } from '../../utils/walk-nested-map'

import type { ReportLeafNode, ScanReport } from './generate-report'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { components } from '@socketsecurity/sdk/types/api'

export async function outputScanReport(
  scan: Array<components['schemas']['SocketArtifact']>,
  // licensePolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>,
  securityPolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>,
  {
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
  }
): Promise<void> {
  if (!includeLicensePolicy && !includeSecurityPolicy) {
    process.exitCode = 1
    return // caller should assert
  }

  const scanReport = generateReport(
    scan,
    undefined, // licensePolicy,
    securityPolicy,
    {
      orgSlug,
      scanId,
      fold,
      reportLevel,
      short,
      // Lazily access constants.spinner.
      spinner: constants.spinner
    }
  )

  if (!scanReport.healthy) {
    process.exitCode = 1
  }

  if (
    outputKind === 'json' ||
    (outputKind === 'text' && filePath && filePath.endsWith('.json'))
  ) {
    const json = short
      ? JSON.stringify(scanReport)
      : toJsonReport(scanReport as ScanReport)

    if (filePath && filePath !== '-') {
      logger.log('Writing json report to', filePath)
      return await fs.writeFile(filePath, json)
    }

    logger.log(json)
    return
  }

  if (outputKind === 'markdown' || (filePath && filePath.endsWith('.md'))) {
    const md = short
      ? `healthy = ${scanReport.healthy}`
      : toMarkdownReport(scanReport as ScanReport)

    if (filePath && filePath !== '-') {
      logger.log('Writing markdown report to', filePath)
      return await fs.writeFile(filePath, md)
    }

    logger.log(md)
    return
  }

  if (short) {
    logger.log(scanReport.healthy ? 'OK' : 'ERR')
  } else {
    logger.dir(scanReport, { depth: null })
  }
}

export function toJsonReport(report: ScanReport): string {
  const obj = mapToObject(report.alerts)

  const json = JSON.stringify(
    {
      ...report,
      alerts: obj
    },
    null,
    2
  )

  return json
}

export function toMarkdownReport(report: ScanReport): string {
  const flatData = Array.from(walkNestedMap(report.alerts)).map(
    ({ keys, value }: { keys: string[]; value: ReportLeafNode }) => {
      const { manifest, policy, type, url } = value
      return {
        'Alert Type': type,
        Package: keys[1] || '<unknown>',
        'Introduced by': keys[2] || '<unknown>',
        url,
        'Manifest file': manifest.join(', '),
        Policy: policy
      }
    }
  )

  const md =
    `
# Scan Policy Report

This report tells you whether the results of a Socket scan results violate the
security or license policy set by your organization.

## Health status

${
  report.healthy
    ? 'The scan *PASSES* all requirements set by your security and license policy.'
    : 'The scan *VIOLATES* one or more policies set to the "error" level.'
}

## Settings

Configuration used to generate this report:

- Organization: ${report.orgSlug}
- Scan ID: ${report.scanId}
- Alert folding: ${report.options.fold === 'none' ? 'none' : `up to ${report.options.fold}`}
- Minimal policy level for alert to be included in report: ${report.options.reportLevel === 'defer' ? 'everything' : report.options.reportLevel}

## Alerts

${
  report.alerts.size
    ? `All the alerts from the scan with a policy set to at least "${report.options.reportLevel}"}.`
    : `The scan contained no alerts for with a policy set to at least "${report.options.reportLevel}".`
}

${
  !report.alerts.size
    ? ''
    : mdTable(flatData, [
        'Policy',
        'Alert Type',
        'Package',
        'Introduced by',
        'url',
        'Manifest file'
      ])
}
  `.trim() + '\n'

  return md
}
