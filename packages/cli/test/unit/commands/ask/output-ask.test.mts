/**
 * Unit tests for Ask command output formatting.
 *
 * Purpose:
 * Tests the output formatting functions for the ask command.
 *
 * Test Coverage:
 * - outputAskCommand function
 * - explainCommand function (via outputAskCommand)
 * - Different action types (scan, package, fix, patch, optimize, issues)
 * - Severity filtering display
 * - Environment display
 * - Dry-run mode display
 * - Confidence warnings
 * - Project context display
 *
 * Related Files:
 * - src/commands/ask/output-ask.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

import { outputAskCommand } from '../../../../src/commands/ask/output-ask.mts'

describe('output-ask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('outputAskCommand', () => {
    it('outputs query and interpretation', () => {
      outputAskCommand({
        query: 'scan my project',
        intent: {
          action: 'scan',
          command: ['scan', 'create'],
          confidence: 0.9,
          explanation: 'Create a security scan of your project',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      expect(mockLogger.log).toHaveBeenCalled()
      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('scan my project')
      expect(logs).toContain('Create a security scan')
    })

    it('shows package name when present', () => {
      outputAskCommand({
        query: 'check lodash',
        intent: {
          action: 'package',
          command: ['package', 'score', 'lodash'],
          confidence: 0.95,
          explanation: 'Check package score',
          packageName: 'lodash',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('lodash')
    })

    it('shows severity with appropriate color', () => {
      outputAskCommand({
        query: 'show critical issues',
        intent: {
          action: 'issues',
          command: ['issues', '--severity', 'critical'],
          confidence: 0.8,
          explanation: 'Show critical security issues',
          severity: 'critical',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('critical')
    })

    it('shows medium severity', () => {
      outputAskCommand({
        query: 'show medium issues',
        intent: {
          action: 'issues',
          command: ['issues', '--severity', 'medium'],
          confidence: 0.8,
          explanation: 'Show medium security issues',
          severity: 'medium',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('medium')
    })

    it('shows low severity', () => {
      outputAskCommand({
        query: 'show low issues',
        intent: {
          action: 'issues',
          command: ['issues', '--severity', 'low'],
          confidence: 0.8,
          explanation: 'Show low security issues',
          severity: 'low',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('low')
    })

    it('shows environment when present', () => {
      outputAskCommand({
        query: 'scan production',
        intent: {
          action: 'scan',
          command: ['scan', 'create', '--prod'],
          confidence: 0.85,
          explanation: 'Scan production dependencies',
          environment: 'production',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('production')
    })

    it('shows dry-run mode when present', () => {
      outputAskCommand({
        query: 'fix issues dry run',
        intent: {
          action: 'fix',
          command: ['fix', '--dry-run'],
          confidence: 0.9,
          explanation: 'Fix issues in dry-run mode',
          isDryRun: true,
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('dry-run')
    })

    it('shows low confidence warning', () => {
      outputAskCommand({
        query: 'something vague',
        intent: {
          action: 'scan',
          command: ['scan', 'create'],
          confidence: 0.5,
          explanation: 'Best guess interpretation',
        },
        context: {
          hasPackageJson: false,
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Low confidence')
    })

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

    it('shows project context when explain is true and package.json exists', () => {
      outputAskCommand({
        query: 'scan project',
        intent: {
          action: 'scan',
          command: ['scan', 'create'],
          confidence: 0.9,
          explanation: 'Create a scan',
        },
        context: {
          hasPackageJson: true,
          dependencies: { lodash: '^4.0.0', express: '^4.0.0' },
          devDependencies: { jest: '^29.0.0' },
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('Project Context')
      expect(logs).toContain('2 packages')
      expect(logs).toContain('1 packages')
    })

    it('handles empty dependencies in context', () => {
      outputAskCommand({
        query: 'scan project',
        intent: {
          action: 'scan',
          command: ['scan', 'create'],
          confidence: 0.9,
          explanation: 'Create a scan',
        },
        context: {
          hasPackageJson: true,
        },
        explain: true,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).toContain('0 packages')
    })

    it('does not show project context when explain is false', () => {
      outputAskCommand({
        query: 'scan project',
        intent: {
          action: 'scan',
          command: ['scan', 'create'],
          confidence: 0.9,
          explanation: 'Create a scan',
        },
        context: {
          hasPackageJson: true,
          dependencies: { lodash: '^4.0.0' },
        },
        explain: false,
      })

      const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
      expect(logs).not.toContain('Project Context')
    })

    it('does not show project context when package.json does not exist', () => {
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
      expect(logs).not.toContain('Project Context')
    })
  })
})
