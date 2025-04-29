import fs from 'node:fs/promises'

import { logger } from '@socketsecurity/registry/lib/logger'

import { generateReport } from './generate-report'
import constants from '../../constants'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { mapToObject } from '../../utils/map-to-object'
import { mdTable } from '../../utils/markdown'
import { serializeResultJson } from '../../utils/serialize-result-json'
import { walkNestedMap } from '../../utils/walk-nested-map'

import type { ReportLeafNode, ScanReport } from './generate-report'
import type { CResult, OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { components } from '@socketsecurity/sdk/types/api'

export async function outputScanReport(
  result: CResult<{
    scan: Array<components['schemas']['SocketArtifact']>
    securityPolicy: SocketSdkReturnType<'getOrgSecurityPolicy'>['data']
  }>,
  {
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
  }
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      logger.log(serializeResultJson(result))
      logger.log('')
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const scanReport = generateReport(
    result.data.scan,
    result.data.securityPolicy,
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
    process.exitCode = 1 // TODO: we could use a different code to distinct program error from health check failure...
  }

  if (
    outputKind === 'json' ||
    (outputKind === 'text' && filePath && filePath.endsWith('.json'))
  ) {
    const json = short
      ? JSON.stringify(scanReport, null, 2)
      : toJsonReport(scanReport as ScanReport, includeLicensePolicy)

    if (filePath && filePath !== '-') {
      logger.log('Writing json report to', filePath)
      return await fs.writeFile(filePath, json)
    }

    logger.log(json)
    logger.log('')
    return
  }

  if (outputKind === 'markdown' || (filePath && filePath.endsWith('.md'))) {
    const md = short
      ? `healthy = ${scanReport.healthy}`
      : toMarkdownReport(scanReport as ScanReport, includeLicensePolicy)

    if (filePath && filePath !== '-') {
      logger.log('Writing markdown report to', filePath)
      return await fs.writeFile(filePath, md)
    }

    logger.log(md)
    logger.log('')
    return
  }

  if (short) {
    logger.log(scanReport.healthy ? 'OK' : 'ERR')
  } else {
    logger.dir(scanReport, { depth: null })
  }
}

export function toJsonReport(
  report: ScanReport,
  includeLicensePolicy?: boolean | undefined
): string {
  const obj = mapToObject(report.alerts)

  const json = JSON.stringify(
    {
      includeLicensePolicy,
      ...report,
      alerts: obj
    },
    null,
    2
  )

  return json
}

export function toMarkdownReport(
  report: ScanReport,
  includeLicensePolicy?: boolean | undefined
): string {
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
security${includeLicensePolicy ? ' or license' : ''} policy set by your organization.

## Health status

${
  report.healthy
    ? `The scan *PASSES* all requirements set by your security${includeLicensePolicy ? ' and license' : ''} policy.`
    : 'The scan *VIOLATES* one or more policies set to the "error" level.'
}

## Settings

Configuration used to generate this report:

- Organization: ${report.orgSlug}
- Scan ID: ${report.scanId}
- Alert folding: ${report.options.fold === 'none' ? 'none' : `up to ${report.options.fold}`}
- Minimal policy level for alert to be included in report: ${report.options.reportLevel === 'defer' ? 'everything' : report.options.reportLevel}
- Include license alerts: ${includeLicensePolicy ? 'yes' : 'no'}

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
