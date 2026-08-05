/**
 * Unit tests for the plain-text scan report renderer.
 *
 * Purpose: The default (non-json, non-markdown) scan report is read in CI/CD
 * logs, where there is no TTY and no interactive pager. These tests pin the
 * properties that make that output legible rather than snapshotting the whole
 * blob, so the assertions say what the contract is.
 *
 * Related Files: - src/commands/scan/output-scan-report.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  flattenReportAlerts,
  toPlainTextReport,
} from '../../../../src/commands/scan/output-scan-report.mts'

import type { ScanReport } from '../../../../src/commands/scan/generate-report.mts'

// Matches any ANSI escape sequence, the codes that show up as literal noise
// like "[32m" in a log viewer that does not interpret them.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const ANSI_PATTERN = /\u001B\[[0-9;]*m/

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
  return new Map([
    [
      'npm',
      new Map([
        [
          'acme-widget',
          new Map([
            [
              '1.0.0',
              {
                manifest: ['package.json'],
                policy: 'error',
                type: 'envVars',
                url: 'https://socket.dev/npm/package/acme-widget',
              },
            ],
          ]),
        ],
      ]),
    ],
  ]) as unknown as ScanReport['alerts']
}

describe('toPlainTextReport', () => {
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
    // oxlint-disable-next-line no-control-regex -- asserting the absence of control characters.
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
    ).split('\n')
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
      .split('\n')
      .filter(line => !line.trim().startsWith('https://') && line.length > 100)

    expect(overlong).toEqual([])
  })

  it('says so plainly when there are no alerts', () => {
    const text = toPlainTextReport(
      buildReport({ alerts: new Map(), healthy: true }),
    )

    expect(text).toContain('No alerts')
    expect(text).not.toContain('ALERT TYPE')
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
        introducedBy: '1.0.0',
        manifest: 'package.json',
        packageName: 'acme-widget',
        policy: 'error',
        url: 'https://socket.dev/npm/package/acme-widget',
      },
    ])
  })
})
