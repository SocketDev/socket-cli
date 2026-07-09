/**
 * Unit tests for Ask command output formatting.
 *
 * Purpose: Tests the explanation output rendered by outputAskCommand when
 * explain mode is enabled, across the different intent action types.
 *
 * Related Files: - src/commands/ask/output-ask.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

import { outputAskCommand } from '../../../../src/commands/ask/output-ask.mts'

describe('output-ask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('outputAskCommand', () => {
    it('shows explanation for scan action when explain is true', () => {
      outputAskCommand({
        query: 'scan project',
        intent: {
          action: 'scan',
          command: ['scan', 'create'],
          confidence: 0.9,
          explanation: 'Create a scan',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Explanation')
      expect(logs).toContain('security scan')
    })

    it('shows explanation for package action', () => {
      outputAskCommand({
        query: 'check package',
        intent: {
          action: 'package',
          command: ['package', 'score', 'lodash'],
          confidence: 0.9,
          explanation: 'Check package score',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('security score')
    })

    it('shows explanation for fix action', () => {
      outputAskCommand({
        query: 'fix vulnerabilities',
        intent: {
          action: 'fix',
          command: ['fix'],
          confidence: 0.9,
          explanation: 'Fix security issues',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('package updates')
    })

    it('shows explanation for fix action with dry-run', () => {
      outputAskCommand({
        query: 'fix dry run',
        intent: {
          action: 'fix',
          command: ['fix', '--dry-run'],
          confidence: 0.9,
          explanation: 'Fix in dry-run mode',
          isDryRun: true,
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Preview mode')
    })

    it('shows explanation for fix action with severity', () => {
      outputAskCommand({
        query: 'fix critical issues',
        intent: {
          action: 'fix',
          command: ['fix', '--severity', 'critical'],
          confidence: 0.9,
          explanation: 'Fix critical security issues',
          severity: 'critical',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('critical severity')
    })

    it('shows explanation for patch action', () => {
      outputAskCommand({
        query: 'patch vulnerabilities',
        intent: {
          action: 'patch',
          command: ['patch'],
          confidence: 0.9,
          explanation: 'Patch vulnerable code',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('patches')
    })

    it('shows explanation for patch action with dry-run', () => {
      outputAskCommand({
        query: 'patch dry run',
        intent: {
          action: 'patch',
          command: ['patch', '--dry-run'],
          confidence: 0.9,
          explanation: 'Patch in dry-run mode',
          isDryRun: true,
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Preview mode')
    })

    it('shows explanation for optimize action', () => {
      outputAskCommand({
        query: 'optimize dependencies',
        intent: {
          action: 'optimize',
          command: ['optimize'],
          confidence: 0.9,
          explanation: 'Optimize dependencies',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Socket registry')
    })

    it('shows explanation for optimize action with dry-run', () => {
      outputAskCommand({
        query: 'optimize dry run',
        intent: {
          action: 'optimize',
          command: ['optimize', '--dry-run'],
          confidence: 0.9,
          explanation: 'Optimize in dry-run mode',
          isDryRun: true,
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Preview mode')
    })

    it('shows explanation for issues action', () => {
      outputAskCommand({
        query: 'list issues',
        intent: {
          action: 'issues',
          command: ['issues'],
          confidence: 0.9,
          explanation: 'List security issues',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('detected issues')
    })

    it('shows explanation for issues action with severity', () => {
      outputAskCommand({
        query: 'list high issues',
        intent: {
          action: 'issues',
          command: ['issues', '--severity', 'high'],
          confidence: 0.9,
          explanation: 'List high severity issues',
          severity: 'high',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Filtered')
    })

    it('shows explanation for scan action with severity filter', () => {
      outputAskCommand({
        query: 'scan critical',
        intent: {
          action: 'scan',
          command: ['scan', 'create', '--severity', 'critical'],
          confidence: 0.9,
          explanation: 'Scan with critical filter',
          severity: 'critical',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Filters results')
    })

    it('shows explanation for scan action with production environment', () => {
      outputAskCommand({
        query: 'scan production',
        intent: {
          action: 'scan',
          command: ['scan', 'create', '--prod'],
          confidence: 0.9,
          explanation: 'Scan production',
          environment: 'production',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('production dependencies')
    })

    it('shows default explanation for unknown action', () => {
      outputAskCommand({
        query: 'do something',
        intent: {
          action: 'unknown',
          command: ['unknown'],
          confidence: 0.9,
          explanation: 'Unknown action',
        },
        context: {
          hasPackageJson: false,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('interpreted command')
    })
  })
})
