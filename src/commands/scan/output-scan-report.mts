import fs from 'node:fs/promises'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { generateReport } from './generate-report.mts'
import constants, { EXT_JSON, JSON, TEXT } from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mapToObject } from '../../utils/map-to-object.mts'
import { mdTable } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'
import { walkNestedMap } from '../../utils/walk-nested-map.mts'

import type { ReportLeafNode, ScanReport } from './generate-report.mts'
import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type OutputScanReportConfig = {
  orgSlug: string
  scanId: string
  includeLicensePolicy: boolean
  outputKind: OutputKind
  filepath: string
  fold: FOLD_SETTING
  reportLevel: REPORT_LEVEL
  short: boolean
}

export async function outputScanReport(
  result: CResult<{
    scan: SocketArtifact[]
    securityPolicy: SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
  }>,
  {
    filepath,
    fold,
    includeLicensePolicy,
    orgSlug,
    outputKind,
    reportLevel,
    scanId,
    short,
  }: OutputScanReportConfig,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === JSON) {
      logger.log(serializeResultJson(result))
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
      spinner: constants.spinner,
    },
  )

  if (!scanReport.ok) {
    // Note: this means generation failed, it does not reflect the healthy state
    process.exitCode = scanReport.code ?? 1

    // If report generation somehow failed then .data should not be set.
    if (outputKind === JSON) {
      logger.log(serializeResultJson(scanReport))
      return
    }
    logger.fail(failMsgWithBadge(scanReport.message, scanReport.cause))
    return
  }

  // I don't think we emit the default error message with banner for an unhealhty report, do we?
  // if (!scanReport.data.healhty) {
  //   logger.fail(failMsgWithBadge(scanReport.message, scanReport.cause))
  //   return
  // }

  if (
    outputKind === JSON ||
    (outputKind === TEXT && filepath && filepath.endsWith(EXT_JSON))
  ) {
    const json = short
      ? serializeResultJson(scanReport)
      : toJsonReport(scanReport.data as ScanReport, includeLicensePolicy)

    if (filepath && filepath !== '-') {
      logger.log('Writing json report to', filepath)
      return await fs.writeFile(filepath, json)
    }

    logger.log(json)
    return
  }

  if (outputKind === 'markdown' || (filepath && filepath.endsWith('.md'))) {
    const md = short
      ? `healthy = ${scanReport.data.healthy}`
      : toMarkdownReport(
          scanReport.data as ScanReport, // not short so must be regular report
          includeLicensePolicy,
        )

    if (filepath && filepath !== '-') {
      logger.log('Writing markdown report to', filepath)
      return await fs.writeFile(filepath, md)
    }

    logger.log(md)
    logger.log('')
    return
  }

  if (short) {
    logger.log(scanReport.data.healthy ? 'OK' : 'ERR')
  } else {
    logger.dir(scanReport.data, { depth: null })
  }
}

export function toJsonReport(
  report: ScanReport,
  includeLicensePolicy?: boolean | undefined,
): string {
  const obj = mapToObject(report.alerts)

  const newReport = {
    includeLicensePolicy,
    ...report,
    alerts: obj,
  }

  return serializeResultJson({
    ok: true,
    data: newReport,
  })
}

export function toMarkdownReport(
  report: ScanReport,
  includeLicensePolicy?: boolean | undefined,
): string {
  const reportLevel = report.options.reportLevel

  const alertFolding =
    report.options.fold === constants.FOLD_SETTING_NONE
      ? 'none'
      : `up to ${report.options.fold}`

  const flatData = Array.from(walkNestedMap(report.alerts)).map(
    ({ keys, value }: { keys: string[]; value: ReportLeafNode }) => {
      const { manifest, policy, type, url } = value
      return {
        'Alert Type': type,
        Package: keys[1] || '<unknown>',
        'Introduced by': keys[2] || '<unknown>',
        url,
        'Manifest file': joinAnd(manifest),
        Policy: policy,
      }
    },
  )

  const minPolicyLevel =
    reportLevel === constants.REPORT_LEVEL_DEFER ? 'everything' : reportLevel

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
- Alert folding: ${alertFolding}
- Minimal policy level for alert to be included in report: ${minPolicyLevel}
- Include license alerts: ${includeLicensePolicy ? 'yes' : 'no'}

## Alerts

${
  report.alerts.size
    ? `All the alerts from the scan with a policy set to at least "${reportLevel}".`
    : `The scan contained no alerts with a policy set to at least "${reportLevel}".`
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
        'Manifest file',
      ])
}
  `.trim() + '\n'

  return md
}
