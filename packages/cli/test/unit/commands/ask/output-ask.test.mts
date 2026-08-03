/**
 * Unit tests for Ask command output formatting.
 *
 * Purpose: Tests the output formatting functions for the ask command.
 *
 * Test Coverage: - outputAskCommand function - Different action types (scan,
 * package, fix, patch, optimize, issues) - Severity filtering display -
 * Environment display - Dry-run mode display - Confidence warnings - Project
 * context display.
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
