import { describe, expect, it } from 'vitest'

import {
  flattenReportAlerts,
  toJsonReport,
  toMarkdownReport,
  toPlainTextReport,
} from './output-scan-report.mts'
import {
  FOLD_SETTING_NONE,
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
} from '../../constants.mts'

import type { ReportLeafNode, ScanReport } from './generate-report.mts'

const ANSI_ESCAPE = String.fromCharCode(0x1b)

function alert(
  policy: ReportLeafNode['policy'],
  type: string,
  manifest: string,
  url: string,
): ReportLeafNode {
  return { manifest: [manifest], policy, type, url }
}

function buildReport(
  config: {
    alerts?: ScanReport['alerts']
    fold?: ScanReport['options']['fold']
    healthy?: boolean
    reportLevel?: ScanReport['options']['reportLevel']
  } = {},
): ScanReport {
  const {
    alerts = new Map(),
    fold = FOLD_SETTING_NONE,
    healthy = true,
    reportLevel = REPORT_LEVEL_ERROR,
  } = config
  return {
    alerts,
    healthy,
    options: { fold, reportLevel },
    orgSlug: 'acme',
    scanId: 'scan-abc-123',
  }
}

function buildAlerts(): ScanReport['alerts'] {
  return new Map([
    [
      'npm',
      new Map([
        [
          'acme-widget-π',
          new Map([
            [
              '1.0.0',
              alert(
                'error',
                'envVars',
                'package.json',
                'https://socket.dev/npm/package/acme-widget',
              ),
            ],
          ]),
        ],
      ]),
    ],
  ])
}

describe('toPlainTextReport', () => {
  it('renders a labelled report without ANSI escapes or raw object dumps', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    expect(text.includes(ANSI_ESCAPE)).toBe(false)
    expect(text).not.toContain('Map(')
    expect(text).not.toContain('=>')
    expect(text).not.toContain('[Object')
    expect(text).toContain('VIOLATES')
    expect(text).toContain('Organization:')
    expect(text).toContain('acme')
    expect(text).toContain('Scan ID:')
    expect(text).toContain('scan-abc-123')
    expect(text).toContain('Alert folding:')
    expect(text).toContain('Minimum policy level:')
  })

  it('preserves Unicode package values and prints alert details', () => {
    const text = toPlainTextReport(buildReport({ alerts: buildAlerts() }))

    expect(text).toContain('PASSES')
    expect(text).toContain('acme-widget-π')
    expect(text).toContain('envVars')
    expect(text).toContain('1.0.0')
    expect(text).toContain('package.json')
    expect(text).toContain('https://socket.dev/npm/package/acme-widget')
  })

  it('aligns columns for one alert and keeps its URL on a separate line', () => {
    const text = toPlainTextReport(buildReport({ alerts: buildAlerts() }))
    const lines = text.split(/\r?\n/)
    const header = lines.find(line => line.includes('ALERT TYPE'))!
    const row = lines.find(line => line.includes('envVars'))!
    const packageColumn = header.indexOf('PACKAGE')

    expect(
      row.slice(packageColumn, packageColumn + 'acme-widget-π'.length),
    ).toBe('acme-widget-π')
    expect(text).toContain('1 alert with a policy')
    expect(lines).toContain('    https://socket.dev/npm/package/acme-widget')
  })

  it('aligns short and long package names across multiple rows', () => {
    const alerts: ScanReport['alerts'] = new Map([
      [
        'npm',
        new Map([
          [
            'pkg-a',
            new Map([['1.0.0', alert('error', 'envVars', 'package.json', '')]]),
          ],
          [
            'pkg-a-much-longer-name',
            new Map([
              ['2.0.0', alert('warn', 'telemetry', 'package-lock.json', '')],
            ]),
          ],
        ]),
      ],
    ])
    const lines = toPlainTextReport(buildReport({ alerts })).split(/\r?\n/)
    const header = lines.find(line => line.includes('ALERT TYPE'))!
    const shortRow = lines.find(line => line.includes('envVars'))!
    const longRow = lines.find(line => line.includes('telemetry'))!
    const packageColumn = header.indexOf('PACKAGE')
    const manifestColumn = header.indexOf('MANIFEST FILE')

    expect(shortRow.slice(packageColumn, packageColumn + 5)).toBe('pkg-a')
    expect(longRow.slice(packageColumn, packageColumn + 22)).toBe(
      'pkg-a-much-longer-name',
    )
    expect(shortRow.slice(manifestColumn, manifestColumn + 12)).toBe(
      'package.json',
    )
    expect(longRow.slice(manifestColumn, manifestColumn + 18)).toBe(
      'package-lock.json',
    )
    expect(
      lines.find(line => line.includes('2 alerts with a policy')),
    ).toBeDefined()
  })

  it('describes empty alerts and omits the alert table', () => {
    const text = toPlainTextReport(buildReport())

    expect(text).toContain('PASSES')
    expect(text).toContain('No alerts')
    expect(text).not.toContain('ALERT TYPE')
  })

  it('includes license, fold and deferred-level settings', () => {
    const text = toPlainTextReport(
      buildReport({
        alerts: buildAlerts(),
        fold: 'version',
        reportLevel: REPORT_LEVEL_DEFER,
      }),
      true,
    )

    expect(text).toContain('security and license policy')
    expect(
      text.split('\n').find(line => line.includes('Alert folding:')),
    ).toContain('up to version')
    expect(
      text.split('\n').find(line => line.includes('Minimum policy level:')),
    ).toContain('everything')
    expect(
      text.split('\n').find(line => line.includes('Include license alerts:')),
    ).toContain('yes')
  })

  it('renders a large alert report without argument-count failures', () => {
    const alertRow = alert('error', 'envVars', 'package.json', '')
    const packages = new Map<string, Map<string, ReportLeafNode>>()
    const alertCount = 200_000
    for (let i = 0; i < alertCount; i += 1) {
      packages.set(
        `package-${String(i).padStart(6, '0')}`,
        new Map([['1.0.0', alertRow]]),
      )
    }
    const alerts: ScanReport['alerts'] = new Map([['npm', packages]])
    const text = toPlainTextReport(buildReport({ alerts }))

    expect(text).toContain('200000 alerts with a policy')
    expect(text).toContain('package-000000')
    expect(text).toContain('package-199999')
  })
})

describe('structured scan reports', () => {
  it('keeps nested alert data and the license flag in JSON', () => {
    const json = toJsonReport(buildReport({ alerts: buildAlerts() }), true)

    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      data: {
        alerts: {
          npm: {
            'acme-widget-π': {
              '1.0.0': {
                manifest: ['package.json'],
                policy: 'error',
                type: 'envVars',
                url: 'https://socket.dev/npm/package/acme-widget',
              },
            },
          },
        },
        includeLicensePolicy: true,
      },
    })
  })

  it('keeps alert fields and URLs in Markdown', () => {
    const markdown = toMarkdownReport(
      buildReport({ alerts: buildAlerts() }),
      true,
    )

    expect(markdown).toContain('security or license policy')
    expect(markdown).toContain('acme-widget-π')
    expect(markdown).toContain('envVars')
    expect(markdown).toContain('package.json')
    expect(markdown).toContain('https://socket.dev/npm/package/acme-widget')
  })

  it('flattens one row per report alert', () => {
    expect(flattenReportAlerts(buildReport({ alerts: buildAlerts() }))).toEqual(
      [
        {
          alertType: 'envVars',
          introducedBy: '1.0.0',
          manifest: 'package.json',
          packageName: 'acme-widget-π',
          policy: 'error',
          url: 'https://socket.dev/npm/package/acme-widget',
        },
      ],
    )
  })
})
