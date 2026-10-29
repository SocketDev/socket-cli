/**
 * Unit tests for the plain-text scan report renderer.
 *
 * Purpose: The default (non-json, non-markdown) scan report is read in CI/CD
 * logs, where there is no TTY and no interactive pager. These tests pin the
 * properties that make that output legible rather than snapshotting the whole
 * blob, so the assertions say what the contract is.
 *
 * Related Files: - src/command/scan/output-scan-report.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  flattenReportAlerts,
  isFullScanReport,
  toPlainTextReport,
} from '../../../../src/command/scan/output-scan-report.mts'

import type {
  EcoMap,
  FileMap,
  PackageMap,
  ReportLeafNode,
  ScanReport,
  VersionMap,
} from '../../../../src/command/scan/report-generation.mts'

// Matches any ANSI escape sequence, the codes that show up as literal noise
// like "[32m" in a log viewer that does not interpret them.
// matching control characters is the point.
// oxlint-disable-next-line no-control-regex -- control chars intended
const ANSI_PATTERN = /\u001B\[[0-9;]*m/

describe('isFullScanReport', () => {
  it('distinguishes full reports from short reports', () => {
    expect(
      isFullScanReport(buildReport({ alerts: new Map(), healthy: true })),
    ).toBe(true)
    expect(isFullScanReport({ healthy: true })).toBe(false)
  })
})

function buildReport(config: {
  alerts: ScanReport['alerts']
  healthy: boolean
}) {
  const { alerts, healthy } = config
  return {
    alerts,
    healthy,
    options: { fold: 'none', reportLevel: 'error' },
    orgSlug: 'acme',
    scanId: 'scan-abc-123',
  } as ScanReport
}

function buildAlerts(): ScanReport['alerts'] {
  const leaf: ReportLeafNode = {
    manifest: ['package.json'],
    policy: 'error',
    type: 'envVars',
    url: 'https://socket.dev/npm/package/acme-widget',
  }
  const fileMap: FileMap = new Map([['envVars at 1:2', leaf]])
  const versionMap: VersionMap = new Map([['package.json', fileMap]])
  const packageMap: PackageMap = new Map([['1.0.0', versionMap]])
  const ecosystemMap: EcoMap = new Map([['acme-widget', packageMap]])

  return new Map([['npm', ecosystemMap]])
}

describe('toPlainTextReport', () => {
  it('labels the package version as a version', () => {
    const report = buildReport({ alerts: buildAlerts(), healthy: false })
    const text = toPlainTextReport(report)

    expect(flattenReportAlerts(report)[0]).toMatchObject({
      packageVersion: '1.0.0',
    })
    expect(text).toContain('VERSION')
    expect(text).toContain('1.0.0')
    expect(text).not.toContain('INTRODUCED BY')
  })

  it('emits no ANSI escape codes', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    expect(text).not.toMatch(ANSI_PATTERN)
  })

  it('emits only printable ASCII, so no glyph can mangle in a log viewer', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    // Everything outside printable ASCII plus newline.
    // asserting the absence of control characters.
    // oxlint-disable-next-line no-control-regex -- control chars intended
    expect(text).not.toMatch(/[^\n\x20-\x7E]/)
  })

  it('never renders a raw JavaScript object dump', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    // The old renderer used logger.dir, which printed nested Maps as
    // "Map(1) { 'npm' => Map(1) { ... } }".
    expect(text).not.toContain('Map(')
    expect(text).not.toContain('=>')
    expect(text).not.toContain('[Object')
  })

  it('labels each setting on its own line', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    expect(text).toContain('Organization:')
    expect(text).toContain('acme')
    expect(text).toContain('Scan ID:')
    expect(text).toContain('scan-abc-123')
    expect(text).toContain('Alert folding:')
    expect(text).toContain('Minimum policy level:')
  })

  it('states the health status in words', () => {
    expect(
      toPlainTextReport(buildReport({ alerts: buildAlerts(), healthy: false })),
    ).toContain('VIOLATES')
    expect(
      toPlainTextReport(buildReport({ alerts: new Map(), healthy: true })),
    ).toContain('PASSES')
  })

  it('lists each alert with its package, source and manifest', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    expect(text).toContain('acme-widget')
    expect(text).toContain('envVars')
    expect(text).toContain('package.json')
    expect(text).toContain('https://socket.dev/npm/package/acme-widget')
  })

  it('aligns the alert columns so the table scans vertically', () => {
    // Two packages of very different name lengths. Without padding the second
    // row's cells slide left and stop lining up under the headers.
    const shortName = 'acme-a'
    const longName = 'acme-a-much-longer-package-name'
    const alerts = new Map([
      [
        'npm',
        new Map([
          [
            shortName,
            new Map([
              [
                '1.0.0',
                {
                  manifest: ['package.json'],
                  policy: 'error',
                  type: 'envVars',
                  url: '',
                },
              ],
            ]),
          ],
          [
            longName,
            new Map([
              [
                '2.0.0',
                {
                  manifest: ['package.json'],
                  policy: 'warn',
                  type: 'telemetry',
                  url: '',
                },
              ],
            ]),
          ],
        ]),
      ],
    ]) as unknown as ScanReport['alerts']

    const lines = toPlainTextReport(
      buildReport({ alerts, healthy: false }),
    ).split(/\r?\n/)
    const header = lines.find(line => line.includes('ALERT TYPE'))!
    const shortRow = lines.find(line => line.includes('envVars'))!
    const longRow = lines.find(line => line.includes('telemetry'))!

    // Each cell must begin at exactly the offset its header begins at.
    const packageColumn = header.indexOf('PACKAGE')
    expect(
      shortRow.slice(packageColumn, packageColumn + shortName.length),
    ).toBe(shortName)
    expect(longRow.slice(packageColumn, packageColumn + longName.length)).toBe(
      longName,
    )

    const manifestColumn = header.indexOf('MANIFEST FILE')
    expect(
      shortRow.slice(manifestColumn, manifestColumn + 'package.json'.length),
    ).toBe('package.json')
    expect(
      longRow.slice(manifestColumn, manifestColumn + 'package.json'.length),
    ).toBe('package.json')
  })

  it('keeps every line within a readable width', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )
    const overlong = text
      .split(/\r?\n/)
      .filter(line => !line.trim().startsWith('https://') && line.length > 100)

    expect(overlong).toEqual([])
  })

  it('renders a large alert report without argument-count failures', () => {
    const alertRow: ReportLeafNode = {
      manifest: ['package.json'],
      policy: 'error',
      type: 'envVars',
      url: '',
    }
    const packages = new Map<string, Map<string, ReportLeafNode>>()
    const alertCount = 200_000
    for (let i = 0; i < alertCount; i += 1) {
      packages.set(
        `package-${String(i).padStart(6, '0')}`,
        new Map([['1.0.0', alertRow]]),
      )
    }
    const alerts: ScanReport['alerts'] = new Map([['npm', packages]])
    const text = toPlainTextReport(buildReport({ alerts, healthy: false }))

    expect(text).toContain('200000 alerts with a policy')
    expect(text).toContain('package-000000')
    expect(text).toContain('package-199999')
  })

  it('says so plainly when there are no alerts', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: new Map(), healthy: true }),
    )

    expect(text).toContain('No alerts')
    expect(text).not.toContain('ALERT TYPE')
    expect(text).not.toContain('VERSION')
  })

  it('retains package versions for version and file folds', () => {
    const versionLeaf: ReportLeafNode = {
      manifest: ['package.json'],
      policy: 'error',
      type: 'envVars',
      url: '',
    }
    const versionFoldAlerts: ScanReport['alerts'] = new Map([
      [
        'npm',
        new Map([['demo-transitive', new Map([['2.3.4', versionLeaf]])]]),
      ],
    ])
    const fileFoldAlerts: ScanReport['alerts'] = new Map([
      [
        'npm',
        new Map([
          [
            'demo-transitive',
            new Map([
              [
                '2.3.4',
                new Map([
                  ['package.json', versionLeaf],
                  [
                    'src/index.js',
                    { ...versionLeaf, manifest: ['package-lock.json'] },
                  ],
                ]),
              ],
            ]),
          ],
        ]),
      ],
    ])
    const versionFoldReport = {
      ...buildReport({ alerts: versionFoldAlerts, healthy: false }),
      options: { fold: 'version' as const, reportLevel: 'error' as const },
    }
    const fileFoldReport = {
      ...buildReport({ alerts: fileFoldAlerts, healthy: false }),
      options: { fold: 'file' as const, reportLevel: 'error' as const },
    }

    expect(flattenReportAlerts(versionFoldReport)[0]?.packageVersion).toBe(
      '2.3.4',
    )
    expect(toPlainTextReport(versionFoldReport)).toContain('VERSION')
    expect(toPlainTextReport(versionFoldReport)).toContain('2.3.4')
    expect(flattenReportAlerts(fileFoldReport)).toEqual([
      expect.objectContaining({
        manifest: 'package.json',
        packageVersion: '2.3.4',
      }),
      expect.objectContaining({
        manifest: 'package-lock.json',
        packageVersion: '2.3.4',
      }),
    ])
    expect(toPlainTextReport(fileFoldReport)).toContain('VERSION')
    expect(toPlainTextReport(fileFoldReport)).toContain('2.3.4')
    expect(toPlainTextReport(fileFoldReport)).toContain('package-lock.json')
  })

  it('keeps package-fold versions unknown and distinguishes package versions', () => {
    const leaf: ReportLeafNode = {
      manifest: ['package.json'],
      policy: 'error',
      type: 'envVars',
      url: '',
    }
    const packageFoldAlerts: ScanReport['alerts'] = new Map([
      ['npm', new Map([['demo-transitive', leaf]])],
    ])
    const twoVersionAlerts: ScanReport['alerts'] = new Map([
      [
        'npm',
        new Map([
          [
            'demo-transitive',
            new Map([
              [
                '2.3.4',
                new Map([
                  ['package.json', new Map([['envVars at 1:2', leaf]])],
                ]),
              ],
              [
                '2.3.5',
                new Map([
                  ['package.json', new Map([['envVars at 3:4', leaf]])],
                ]),
              ],
            ]),
          ],
        ]),
      ],
    ])
    const packageFoldReport = {
      ...buildReport({ alerts: packageFoldAlerts, healthy: false }),
      options: { fold: 'pkg' as const, reportLevel: 'error' as const },
    }
    const twoVersionReport = {
      ...buildReport({ alerts: twoVersionAlerts, healthy: false }),
      options: { fold: 'none' as const, reportLevel: 'error' as const },
    }

    expect(flattenReportAlerts(packageFoldReport)[0]?.packageVersion).toBe(
      '<unknown>',
    )
    expect(toPlainTextReport(packageFoldReport)).toContain('<unknown>')
    expect(
      flattenReportAlerts(twoVersionReport).map(row => row.packageVersion),
    ).toEqual(['2.3.4', '2.3.5'])
  })
})

describe('flattenReportAlerts', () => {
  it('returns one row per alert with the nesting keys resolved', () => {
    const rows = flattenReportAlerts(
      buildReport({ alerts: buildAlerts(), healthy: false }),
    )

    expect(rows).toEqual([
      {
        alertType: 'envVars',
        manifest: 'package.json',
        packageName: 'acme-widget',
        packageVersion: '1.0.0',
        policy: 'error',
        url: 'https://socket.dev/npm/package/acme-widget',
      },
    ])
  })
})
