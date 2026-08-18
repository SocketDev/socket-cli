import fs from 'node:fs/promises'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'
import { pluralize } from '@socketsecurity/lib-stable/words/pluralize'

import { generateReport } from './generate-report.mts'
import {
  FOLD_SETTING_NONE,
  OUTPUT_JSON,
  OUTPUT_TEXT,
} from '../../constants/cli.mts'
import { REPORT_LEVEL_DEFER } from '../../constants/reporting.mts'
import { mapToObject } from '../../util/data/map-to-object.mjs'
import { walkNestedMap } from '../../util/data/walk-nested-map.mjs'
import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdTable } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'

import type { ReportLeafNode, ScanReport } from './generate-report.mts'
import type { FOLD_SETTING, REPORT_LEVEL } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../util/alert/artifact.mts'
const logger = getDefaultLogger()

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

export type ReportAlertRow = {
  alertType: string
  introducedBy: string
  manifest: string
  packageName: string
  policy: string
  url: string
}

/**
 * Flatten the nested ecosystem/package/version alert maps into one row per
 * alert. Both the markdown and the plain-text renderer read the same rows so
 * the two formats can never drift apart.
 */
export function flattenReportAlerts(report: ScanReport): ReportAlertRow[] {
  return Array.from(walkNestedMap(report.alerts)).map(
    ({ keys, value }: { keys: string[]; value: ReportLeafNode }) => {
      const { manifest, policy, type, url } = value
      return {
        alertType: type,
        introducedBy: keys[2] || '<unknown>',
        manifest: joinAnd(manifest),
        packageName: keys[1] || '<unknown>',
        policy,
        url,
      }
    },
  )
}

/**
 * Lay the alerts out as space-padded columns with each alert's URL on its own
 * indented line, so a long URL cannot stretch the table past a readable width.
 */
export function formatAlertTable(rows: ReportAlertRow[]): string[] {
  const headers = [
    'POLICY',
    'ALERT TYPE',
    'PACKAGE',
    'INTRODUCED BY',
    'MANIFEST FILE',
  ]
  const cells = rows.map(row => [
    row.policy,
    row.alertType,
    row.packageName,
    row.introducedBy,
    row.manifest,
  ])
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...cells.map(cell => (cell[i] ?? '').length)),
  )
  const toRow = (values: string[]) =>
    `  ${values
      .map((value, i) => value.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()}`

  const out = [toRow(headers), toRow(widths.map(width => '-'.repeat(width)))]
  for (let i = 0, { length } = cells; i < length; i += 1) {
    out.push(toRow(cells[i]!))
    const { url } = rows[i]!
    if (url) {
      out.push(`    ${url}`)
    }
  }
  return out
}

/**
 * Space-pad `Label:` prefixes so the values line up in a column.
 */
export function formatLabelledPairs(pairs: Array<[string, string]>): string[] {
  const width = Math.max(...pairs.map(pair => pair[0].length))
  return pairs.map(
    ([label, value]) => `  ${`${label}:`.padEnd(width + 1)}  ${value}`,
  )
}

export async function outputScanReport(
  result: CResult<{
    scan: SocketArtifact[]
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
    if (outputKind === OUTPUT_JSON) {
      logger.log(serializeResultJson(result))
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const spinner = getDefaultSpinner()
  const scanReport = generateReport(result.data.scan, {
    orgSlug,
    scanId,
    fold,
    reportLevel,
    short,
    spinner,
  })

  if (!scanReport.ok) {
    // Note: This means generation failed, it does not reflect the healthy state.
    process.exitCode = scanReport.code ?? 1

    // If report generation somehow failed then .data should not be set.
    if (outputKind === OUTPUT_JSON) {
      logger.log(serializeResultJson(scanReport))
      return
    }
    logger.fail(failMsgWithBadge(scanReport.message, scanReport.cause))
    return
  }

  if (!scanReport.data.healthy) {
    // When report contains healthy: false, process should exit with non-zero code.
    process.exitCode = 1
  }

  // I don't think we emit the default error message with banner for an unhealthy report, do we?
  // if (!scanReport.data.healthy) {
  //   logger.fail(failMsgWithBadge(scanReport.message, scanReport.cause))
  //   return
  // }

  if (
    outputKind === OUTPUT_JSON ||
    (outputKind === OUTPUT_TEXT && filepath && filepath.endsWith('.json'))
  ) {
    const json = short
      ? serializeResultJson(scanReport)
      : toJsonReport(scanReport.data as ScanReport, includeLicensePolicy)

    if (filepath && filepath !== '-') {
      logger.error('Writing json report to', filepath)
      return await fs.writeFile(filepath, json)
    }

    logger.log(json)
    return
  }

  if (outputKind === 'markdown' || filepath?.endsWith('.md')) {
    const md = short
      ? `healthy = ${scanReport.data.healthy}`
      : toMarkdownReport(
          // Not short so must be a regular report.
          scanReport.data as ScanReport,
          includeLicensePolicy,
        )

    if (filepath && filepath !== '-') {
      logger.error('Writing markdown report to', filepath)
      return await fs.writeFile(filepath, md)
    }

    logger.log(md)
    logger.log('')
    return
  }

  if (short) {
    logger.log(scanReport.data.healthy ? 'OK' : 'ERR')
  } else {
    logger.log(
      toPlainTextReport(scanReport.data as ScanReport, includeLicensePolicy),
    )
  }
}

// Collapsing into an options object would change call sites in
// test/unit/commands/scan/output-scan-report.test.mts, which is out of scope
// for this pass.
export function toJsonReport(
  report: ScanReport,
  // oxlint-disable-next-line socket/no-boolean-trap-param -- out of scope
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

// Collapsing into an options object would change call sites in
// test/unit/commands/scan/output-scan-report.test.mts, which is out of scope
// for this pass.
export function toMarkdownReport(
  report: ScanReport,
  // oxlint-disable-next-line socket/no-boolean-trap-param -- out of scope
  includeLicensePolicy?: boolean | undefined,
): string {
  const reportLevel = report.options.reportLevel

  const alertFolding =
    report.options.fold === FOLD_SETTING_NONE
      ? 'none'
      : `up to ${report.options.fold}`

  const flatData = flattenReportAlerts(report).map(row => ({
    'Alert Type': row.alertType,
    Package: row.packageName,
    'Introduced by': row.introducedBy,
    url: row.url,
    'Manifest file': row.manifest,
    Policy: row.policy,
  }))

  const minPolicyLevel =
    reportLevel === REPORT_LEVEL_DEFER ? 'everything' : reportLevel

  const md = `${`
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
  `.trim()}\n`

  return md
}

/**
 * Render the report as plain text for a terminal or a CI/CD log.
 *
 * Log viewers show one long stream of monospaced lines, so this sticks to
 * labelled sections and space-padded columns. There is no colour, no
 * box-drawing, and no character outside printable ASCII, which keeps the
 * output readable when a log is piped to a file, replayed without a TTY, or
 * ingested by a log aggregator.
 */
// Matches the toJsonReport / toMarkdownReport signatures this sits beside;
// changing one alone would split the trio.
export function toPlainTextReport(
  report: ScanReport,
  // oxlint-disable-next-line socket/no-boolean-trap-param -- signature trio
  includeLicensePolicy?: boolean | undefined,
): string {
  const { reportLevel } = report.options
  const policyWord = includeLicensePolicy ? 'security and license' : 'security'
  const alertFolding =
    report.options.fold === FOLD_SETTING_NONE
      ? 'none'
      : `up to ${report.options.fold}`
  const minPolicyLevel =
    reportLevel === REPORT_LEVEL_DEFER ? 'everything' : reportLevel

  const lines = [
    'Socket scan policy report',
    '',
    'Health status',
    report.healthy
      ? `  PASSES all requirements set by your ${policyWord} policy.`
      : '  VIOLATES one or more policies set to the "error" level.',
    '',
    'Settings',
    ...formatLabelledPairs([
      ['Organization', report.orgSlug],
      ['Scan ID', report.scanId],
      ['Alert folding', alertFolding],
      ['Minimum policy level', minPolicyLevel],
      ['Include license alerts', includeLicensePolicy ? 'yes' : 'no'],
    ]),
    '',
    'Alerts',
  ]

  const rows = flattenReportAlerts(report)
  if (!rows.length) {
    lines.push(
      `  No alerts with a policy set to at least "${reportLevel}".`,
      '',
    )
    return lines.join('\n')
  }

  lines.push(
    `  ${rows.length} ${pluralize('alert', { count: rows.length })} with a policy set to at least "${reportLevel}".`,
    '',
    ...formatAlertTable(rows),
    '',
  )
  return lines.join('\n')
}
