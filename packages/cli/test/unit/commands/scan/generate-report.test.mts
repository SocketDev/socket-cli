/**
 * Unit tests for scan report generation.
 *
 * Purpose:
 * Tests the report generation from scan artifacts.
 *
 * Test Coverage:
 * - generateReport function
 * - Policy action handling (error, warn, monitor, ignore, defer)
 * - Fold settings (pkg, version, file)
 * - Report level filtering
 * - Health status determination
 *
 * Related Files:
 * - src/commands/scan/generate-report.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock socket URL utility.
vi.mock('../../../../src/utils/socket/url.mts', () => ({
  getSocketDevPackageOverviewUrlFromPurl: (art: { name: string }) =>
    `https://socket.dev/pkg/${art.name}`,
}))

import { generateReport } from '../../../../src/commands/scan/generate-report.mts'
import {
  FOLD_SETTING_FILE,
  FOLD_SETTING_NONE,
  FOLD_SETTING_PKG,
  FOLD_SETTING_VERSION,
} from '../../../../src/constants/cli.mts'
import {
  REPORT_LEVEL_DEFER,
  REPORT_LEVEL_ERROR,
  REPORT_LEVEL_IGNORE,
  REPORT_LEVEL_MONITOR,
  REPORT_LEVEL_WARN,
} from '../../../../src/constants/reporting.mts'

import type { SocketArtifact } from '../../../../src/utils/alert/artifact.mts'

describe('generate-report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateReport', () => {
    const createArtifact = (overrides: Partial<SocketArtifact> = {}) =>
      ({
        type: 'npm',
        name: 'test-pkg',
        version: '1.0.0',
        alerts: [],
        manifestFiles: [{ file: 'package.json' }],
        ...overrides,
      }) as SocketArtifact

    const createSecurityPolicy = (
      rules: Record<string, { action: string }> = {},
    ) => ({
      securityPolicyRules: rules,
    })

    const defaultOptions = {
      fold: FOLD_SETTING_NONE,
      orgSlug: 'my-org',
      reportLevel: REPORT_LEVEL_ERROR,
      scanId: 'scan-123',
    }

    it('returns healthy report when no alerts', () => {
      const scan = [createArtifact()]
      const policy = createSecurityPolicy()

      const result = generateReport(scan, policy as any, defaultOptions)

      expect(result.ok).toBe(true)
      expect(result.data).toEqual(
        expect.objectContaining({
          healthy: true,
          orgSlug: 'my-org',
          scanId: 'scan-123',
        }),
      )
    })

    it('returns short report when short option is true', () => {
      const scan = [createArtifact()]
      const policy = createSecurityPolicy()

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        short: true,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toEqual({ healthy: true })
    })

    it('marks unhealthy when error policy alerts exist', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'badAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        badAlert: { action: 'error' },
      })

      const result = generateReport(scan, policy as any, defaultOptions)

      expect(result.ok).toBe(true)
      expect(result.data).toEqual(
        expect.objectContaining({
          healthy: false,
        }),
      )
      expect(result.message).toContain('violates the policies')
    })

    it('stays healthy with warn policy alerts', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'warnAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        warnAlert: { action: 'warn' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        reportLevel: REPORT_LEVEL_WARN,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toEqual(
        expect.objectContaining({
          healthy: true,
        }),
      )
    })

    it('includes warn alerts when reportLevel is warn', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'warnAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        warnAlert: { action: 'warn' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        reportLevel: REPORT_LEVEL_WARN,
      })

      expect(result.ok).toBe(true)
      const data = result.data as { alerts: Map<string, any> }
      expect(data.alerts.size).toBeGreaterThan(0)
    })

    it('excludes warn alerts when reportLevel is error', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'warnAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        warnAlert: { action: 'warn' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        reportLevel: REPORT_LEVEL_ERROR,
      })

      expect(result.ok).toBe(true)
      const data = result.data as { alerts: Map<string, any> }
      expect(data.alerts.size).toBe(0)
    })

    it('includes monitor alerts when reportLevel is monitor', () => {
      const scan = [
        createArtifact({
          alerts: [
            { type: 'monitorAlert', file: 'index.js', start: 0, end: 10 },
          ],
        }),
      ]
      const policy = createSecurityPolicy({
        monitorAlert: { action: 'monitor' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        reportLevel: REPORT_LEVEL_MONITOR,
      })

      expect(result.ok).toBe(true)
      const data = result.data as { alerts: Map<string, any> }
      expect(data.alerts.size).toBeGreaterThan(0)
    })

    it('includes ignore alerts when reportLevel is ignore', () => {
      const scan = [
        createArtifact({
          alerts: [
            { type: 'ignoreAlert', file: 'index.js', start: 0, end: 10 },
          ],
        }),
      ]
      const policy = createSecurityPolicy({
        ignoreAlert: { action: 'ignore' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        reportLevel: REPORT_LEVEL_IGNORE,
      })

      expect(result.ok).toBe(true)
      const data = result.data as { alerts: Map<string, any> }
      expect(data.alerts.size).toBeGreaterThan(0)
    })

    it('includes defer alerts when reportLevel is defer', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'deferAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        deferAlert: { action: 'defer' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        reportLevel: REPORT_LEVEL_DEFER,
      })

      expect(result.ok).toBe(true)
      const data = result.data as { alerts: Map<string, any> }
      expect(data.alerts.size).toBeGreaterThan(0)
    })

    describe('fold settings', () => {
      const alertedArtifact = createArtifact({
        alerts: [{ type: 'badAlert', file: 'index.js', start: 0, end: 10 }],
      })
      const errorPolicy = createSecurityPolicy({
        badAlert: { action: 'error' },
      })

      it('folds by package when fold is pkg', () => {
        const result = generateReport([alertedArtifact], errorPolicy as any, {
          ...defaultOptions,
          fold: FOLD_SETTING_PKG,
        })

        expect(result.ok).toBe(true)
        const data = result.data as { alerts: Map<string, any> }
        const npmMap = data.alerts.get('npm')
        expect(npmMap).toBeDefined()
        // Should have leaf node directly under package name.
        const leaf = npmMap.get('test-pkg')
        expect(leaf).toHaveProperty('type', 'badAlert')
      })

      it('folds by version when fold is version', () => {
        const result = generateReport([alertedArtifact], errorPolicy as any, {
          ...defaultOptions,
          fold: FOLD_SETTING_VERSION,
        })

        expect(result.ok).toBe(true)
        const data = result.data as { alerts: Map<string, any> }
        const npmMap = data.alerts.get('npm')
        const pkgMap = npmMap.get('test-pkg')
        expect(pkgMap).toBeDefined()
        // Should have leaf node directly under version.
        const leaf = pkgMap.get('1.0.0')
        expect(leaf).toHaveProperty('type', 'badAlert')
      })

      it('folds by file when fold is file', () => {
        const result = generateReport([alertedArtifact], errorPolicy as any, {
          ...defaultOptions,
          fold: FOLD_SETTING_FILE,
        })

        expect(result.ok).toBe(true)
        const data = result.data as { alerts: Map<string, any> }
        const npmMap = data.alerts.get('npm')
        const pkgMap = npmMap.get('test-pkg')
        const verMap = pkgMap.get('1.0.0')
        expect(verMap).toBeDefined()
        // Should have leaf node directly under file.
        const leaf = verMap.get('index.js')
        expect(leaf).toHaveProperty('type', 'badAlert')
      })

      it('does not fold when fold is none', () => {
        const result = generateReport([alertedArtifact], errorPolicy as any, {
          ...defaultOptions,
          fold: FOLD_SETTING_NONE,
        })

        expect(result.ok).toBe(true)
        const data = result.data as { alerts: Map<string, any> }
        const npmMap = data.alerts.get('npm')
        const pkgMap = npmMap.get('test-pkg')
        const verMap = pkgMap.get('1.0.0')
        const fileMap = verMap.get('index.js')
        expect(fileMap).toBeDefined()
        // Should have leaf node under alert key.
        const keys = Array.from(fileMap.keys())
        expect(keys.length).toBe(1)
        expect(keys[0]).toContain('badAlert')
      })
    })

    it('handles artifacts with missing name/version', () => {
      const scan = [
        createArtifact({
          name: undefined as any,
          version: undefined as any,
          alerts: [{ type: 'badAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        badAlert: { action: 'error' },
      })

      const result = generateReport(scan, policy as any, defaultOptions)

      expect(result.ok).toBe(true)
      expect(result.data).toEqual(
        expect.objectContaining({
          healthy: false,
        }),
      )
    })

    it('handles artifacts with no manifestFiles', () => {
      const scan = [
        createArtifact({
          manifestFiles: undefined as any,
          alerts: [{ type: 'badAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        badAlert: { action: 'error' },
      })

      const result = generateReport(scan, policy as any, defaultOptions)

      expect(result.ok).toBe(true)
    })

    it('handles alerts with no file', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'badAlert', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        badAlert: { action: 'error' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        fold: FOLD_SETTING_NONE,
      })

      expect(result.ok).toBe(true)
    })

    it('handles unknown policy actions', () => {
      const scan = [
        createArtifact({
          alerts: [
            { type: 'unknownAlert', file: 'index.js', start: 0, end: 10 },
          ],
        }),
      ]
      const policy = createSecurityPolicy({
        unknownAlert: { action: 'unknown-action' },
      })

      const result = generateReport(scan, policy as any, defaultOptions)

      expect(result.ok).toBe(true)
      expect(result.data).toEqual(
        expect.objectContaining({
          healthy: true,
        }),
      )
    })

    it('handles missing security policy rules', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'badAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = {} // No securityPolicyRules.

      const result = generateReport(scan, policy as any, defaultOptions)

      expect(result.ok).toBe(true)
      expect(result.data).toEqual(
        expect.objectContaining({
          healthy: true,
        }),
      )
    })

    it('prefers stricter policy when multiple alerts on same target', () => {
      const scan = [
        createArtifact({
          alerts: [
            { type: 'warnAlert', file: 'index.js', start: 0, end: 10 },
            { type: 'errorAlert', file: 'index.js', start: 0, end: 10 },
          ],
        }),
      ]
      const policy = createSecurityPolicy({
        warnAlert: { action: 'warn' },
        errorAlert: { action: 'error' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        fold: FOLD_SETTING_PKG,
        reportLevel: REPORT_LEVEL_WARN,
      })

      expect(result.ok).toBe(true)
      const data = result.data as { alerts: Map<string, any> }
      const npmMap = data.alerts.get('npm')
      const leaf = npmMap.get('test-pkg')
      expect(leaf.policy).toBe('error')
    })

    it('calls spinner methods when provided', () => {
      const mockSpinner = {
        start: vi.fn(),
        successAndStop: vi.fn(),
      }
      const scan = [createArtifact()]
      const policy = createSecurityPolicy()

      generateReport(scan, policy as any, {
        ...defaultOptions,
        spinner: mockSpinner as any,
      })

      expect(mockSpinner.start).toHaveBeenCalledWith('Generating report...')
      expect(mockSpinner.successAndStop).toHaveBeenCalledWith(
        expect.stringContaining('Generated reported in'),
      )
    })

    it('returns short unhealthy report for error alerts', () => {
      const scan = [
        createArtifact({
          alerts: [{ type: 'badAlert', file: 'index.js', start: 0, end: 10 }],
        }),
      ]
      const policy = createSecurityPolicy({
        badAlert: { action: 'error' },
      })

      const result = generateReport(scan, policy as any, {
        ...defaultOptions,
        short: true,
      })

      expect(result.ok).toBe(true)
      expect(result.data).toEqual({ healthy: false })
    })
  })
})
