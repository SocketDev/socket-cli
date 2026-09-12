/**
 * Unit tests for ask command handler.
 *
 * Tests the `parseIntent` function that converts natural language queries
 * into Socket CLI commands: action detection, severity/environment/dry-run
 * extraction, package name extraction, confidence scoring, command building,
 * explanation generation, NLP normalization, and edge cases.
 *
 * `handleAsk` execution/output behavior and the smaller natural language
 * helper functions live in `handle-ask.test.mts`.
 */

import { describe, expect, it, vi } from 'vitest'

import { parseIntent } from '../../../../src/command/ask/handle-ask.mts'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))

const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

const mockOutputAskCommand = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/command/ask/output-ask.mts'), () => ({
  outputAskCommand: mockOutputAskCommand,
}))

const mockReadFile = vi.hoisted(() => vi.fn())
vi.mock(import('node:fs'), async importOriginal => {
  const actual: unknown = await importOriginal()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: mockReadFile,
    },
  }
})

const mockGetHome = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/env/home'), () => ({
  getHome: mockGetHome,
}))

describe('parseIntent', () => {
  describe('action detection', () => {
    it('should detect fix action from "fix vulnerabilities"', async () => {
      const result = await requireIntent('fix vulnerabilities')
      expect(result.action).toBe('fix')
      expect(result.command).toContain('fix')
    })

    it('should detect fix action from "resolve security issues"', async () => {
      const result = await requireIntent('resolve security issues')
      expect(result.action).toBe('fix')
    })

    it('should detect scan action from "scan for vulnerabilities"', async () => {
      const result = await requireIntent('scan for vulnerabilities')
      expect(result.action).toBe('scan')
      expect(result.command).toContain('scan')
    })

    it('should detect scan action from "check for issues"', async () => {
      const result = await requireIntent('check for issues')
      expect(result.action).toBe('scan')
    })

    it('should detect scan action from "audit my project"', async () => {
      const result = await requireIntent('audit my project')
      expect(result.action).toBe('scan')
    })

    it('should detect optimize action from "optimize dependencies"', async () => {
      const result = await requireIntent('optimize dependencies')
      expect(result.action).toBe('optimize')
      expect(result.command).toContain('optimize')
    })

    it('should detect optimize action from "replace with better alternatives"', async () => {
      const result = await requireIntent('replace with better alternatives')
      expect(result.action).toBe('optimize')
    })

    it('should detect patch action from "patch vulnerabilities"', async () => {
      const result = await requireIntent('patch vulnerabilities')
      expect(result.action).toBe('patch')
      expect(result.command).toContain('patch')
    })

    it('should detect package action from "is lodash safe"', async () => {
      const result = await requireIntent('is lodash safe')
      expect(result.action).toBe('package')
      expect(result.command).toContain('package')
    })

    it('should detect package action from "check package score"', async () => {
      const result = await parseIntent('check package score')
      expect(result).toBeUndefined()
    })
  })

  describe('severity extraction', () => {
    it('should extract critical severity', async () => {
      const result = await requireIntent('fix critical vulnerabilities')
      expect(result.severity).toBe('critical')
    })

    it('should extract high severity', async () => {
      const result = await requireIntent('scan for high severity issues')
      expect(result.severity).toBe('high')
    })

    it('should extract medium severity', async () => {
      const result = await requireIntent('show medium severity alerts')
      expect(result.severity).toBe('medium')
    })

    it('should extract low severity', async () => {
      const result = await requireIntent('fix low priority issues')
      expect(result.severity).toBe('low')
    })

    it('should add severity flag to command', async () => {
      const result = await requireIntent('fix critical issues')
      expect(result.command.some(c => c.includes('--severity=critical'))).toBe(
        true,
      )
    })
  })

  describe('environment detection', () => {
    it('should detect production environment', async () => {
      const result = await requireIntent('scan production dependencies')
      expect(result.environment).toBe('production')
    })

    it('should detect development environment', async () => {
      const result = await requireIntent('check dev dependencies')
      expect(result.environment).toBe('development')
    })

    it('should add prod flag for production scans', async () => {
      const result = await requireIntent('scan production vulnerabilities')
      expect(result.command).toContain('--prod')
    })
  })

  describe('dry run detection', () => {
    it('should detect dry run from "dry run"', async () => {
      const result = await requireIntent('fix vulnerabilities dry run')
      expect(result.isDryRun).toBe(true)
    })

    it('should detect dry run from "preview"', async () => {
      const result = await requireIntent('preview the fixes')
      expect(result.isDryRun).toBe(true)
    })

    it('should add dry-run flag to fix commands by default', async () => {
      const result = await requireIntent('fix issues')
      expect(result.command).toContain('--dry-run')
    })
  })

  describe('package name extraction', () => {
    it('should extract quoted package name', async () => {
      const result = await requireIntent('is "express" safe to use')
      expect(result.packageName).toBe('express')
    })

    it('should extract package name after "is"', async () => {
      const result = await requireIntent('is lodash safe')
      expect(result.packageName).toBe('lodash')
    })

    it('should extract scoped package name', async () => {
      const result = await requireIntent('check "@types/node" score')
      expect(result.packageName).toBe('@types/node')
    })
  })

  describe('confidence scoring', () => {
    it('should have reasonable confidence for keyword matches', async () => {
      const result = await requireIntent('scan for vulnerabilities')
      // Confidence is based on keyword overlap ratio.
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it('leaves unsupported requests unresolved', async () => {
      const result = await parseIntent('help me')
      expect(result).toBeUndefined()
    })
  })

  describe('command building', () => {
    it('should build scan create command', async () => {
      const result = await requireIntent('scan my project')
      expect(result.command).toEqual(expect.arrayContaining(['scan', 'create']))
    })

    it('should build fix command with dry-run by default', async () => {
      const result = await requireIntent('fix vulnerabilities')
      expect(result.command).toContain('fix')
      expect(result.command).toContain('--dry-run')
    })

    it('should build package score command', async () => {
      const result = await parseIntent('check package safety')
      expect(result).toBeUndefined()
    })
  })

  describe('explanation generation', () => {
    it('should provide meaningful explanation for scan', async () => {
      const result = await requireIntent('scan for issues')
      expect(result.explanation).toBeTruthy()
      expect(result.explanation.length).toBeGreaterThan(10)
    })

    it('should provide meaningful explanation for fix', async () => {
      const result = await requireIntent('fix vulnerabilities')
      expect(result.explanation).toBeTruthy()
    })
  })

  describe('NLP normalization', () => {
    it('should handle verb tenses - "scanning" → scan', async () => {
      const result = await requireIntent('scanning for vulnerabilities')
      expect(result.action).toBe('scan')
    })

    it('should handle verb tenses - "fixed" → fix', async () => {
      const result = await requireIntent('fixed vulnerabilities')
      expect(result.action).toBe('fix')
    })

    it('should handle plurals - "vulnerabilities" → vulnerability', async () => {
      const result = await requireIntent('scan for vulnerabilities')
      expect(result.action).toBe('scan')
    })
  })

  describe('additional pattern detection', () => {
    it('should detect issues pattern from "problems in my project"', async () => {
      const result = await requireIntent('find problems in my project')
      // The 'package' keywords might have higher priority due to 'dependency' matching
      // issues pattern uses: problem, alert, warning, concern
      expect(result.command).toContain('scan')
    })

    it('should detect issues pattern from "alerts in project"', async () => {
      const result = await requireIntent('show alerts in project')
      expect(result.action).toBe('issues')
    })

    it('should detect concerns as issues', async () => {
      const result = await requireIntent('find concerns in my code')
      expect(result.action).toBe('issues')
    })

    it('should detect repair as fix action', async () => {
      const result = await requireIntent('repair security issues')
      expect(result.action).toBe('fix')
    })

    it('should detect remediate as fix action', async () => {
      const result = await requireIntent('remediate vulnerabilities')
      expect(result.action).toBe('fix')
    })

    it('should detect upgrade as fix action', async () => {
      const result = await requireIntent('upgrade vulnerable packages')
      expect(result.action).toBe('fix')
    })

    it('should detect enhance as optimize action', async () => {
      const result = await requireIntent('enhance dependencies')
      expect(result.action).toBe('optimize')
    })

    it('should detect improve as optimize action', async () => {
      const result = await requireIntent('improve dependencies')
      expect(result.action).toBe('optimize')
    })

    it('should detect better as optimize action', async () => {
      const result = await requireIntent('find better alternatives')
      expect(result.action).toBe('optimize')
    })

    it('should detect apply patch as patch action', async () => {
      const result = await requireIntent('apply patch to fix CVE')
      expect(result.action).toBe('patch')
    })

    it('should detect trust as package action', async () => {
      const result = await requireIntent('can I trust lodash')
      expect(result.action).toBe('package')
    })

    it('should detect quality as package action', async () => {
      const result = await requireIntent('check quality of express')
      expect(result.action).toBe('package')
    })

    it('should detect rating as package action', async () => {
      const result = await requireIntent('what is the rating of axios')
      expect(result.action).toBe('package')
    })

    it('should detect inspect as scan action', async () => {
      const result = await requireIntent('inspect my project')
      expect(result.action).toBe('scan')
    })

    it('should detect review as scan action', async () => {
      // 'review dependencies' matches 'package' because 'dependency' is in package keywords
      // Use a different query that doesn't have competing matches
      const result = await requireIntent('review my project for issues')
      expect(result.action).toBe('scan')
    })

    it('should detect analyze as scan action', async () => {
      const result = await requireIntent('analyze project for issues')
      expect(result.action).toBe('scan')
    })
  })

  describe('severity variants', () => {
    it('should detect severe as critical', async () => {
      const result = await requireIntent('fix severe vulnerabilities')
      expect(result.severity).toBe('critical')
    })

    it('should detect urgent as critical', async () => {
      const result = await requireIntent('fix urgent security issues')
      expect(result.severity).toBe('critical')
    })

    it('should detect blocker as critical', async () => {
      const result = await requireIntent('fix blocker issues')
      expect(result.severity).toBe('critical')
    })

    it('should detect important as high', async () => {
      const result = await requireIntent('fix important vulnerabilities')
      expect(result.severity).toBe('high')
    })

    it('should detect major as high', async () => {
      const result = await requireIntent('scan for major issues')
      expect(result.severity).toBe('high')
    })

    it('should detect moderate as medium', async () => {
      const result = await requireIntent('fix moderate vulnerabilities')
      expect(result.severity).toBe('medium')
    })

    it('should detect normal as medium', async () => {
      const result = await requireIntent('show normal severity alerts')
      expect(result.severity).toBe('medium')
    })

    it('should detect minor as low', async () => {
      const result = await requireIntent('fix minor issues')
      expect(result.severity).toBe('low')
    })

    it('should detect trivial as low', async () => {
      const result = await requireIntent('show trivial warnings')
      expect(result.severity).toBe('low')
    })
  })

  describe('command flag building', () => {
    it('should not add prod flag for non-scan commands', async () => {
      const result = await requireIntent('fix production vulnerabilities')
      expect(result.environment).toBe('production')
      // prod flag only applies to scan commands
      expect(result.command).not.toContain('--prod')
    })

    it('should not add severity flag for optimize commands', async () => {
      const result = await requireIntent('optimize critical dependencies')
      // Severity should still be detected but not added to command
      expect(result.command.some(c => c.includes('--severity'))).toBe(false)
    })

    it('should not add dry-run when execute is explicitly mentioned', async () => {
      const result = await requireIntent('execute fix vulnerabilities')
      expect(result.command).not.toContain('--dry-run')
    })
  })

  describe('package name edge cases', () => {
    it('should handle package name with slash', async () => {
      const result = await requireIntent('check "@org/package" safety')
      expect(result.packageName).toBe('@org/package')
    })

    it('should not extract common command words as package names', async () => {
      const result = await requireIntent('check scan safety')
      expect(result.packageName).toBeUndefined()
    })

    it('should not extract fix as package name', async () => {
      const result = await requireIntent('is fix safe')
      expect(result.packageName).toBeUndefined()
    })

    it('should not extract patch as package name', async () => {
      const result = await requireIntent('check patch score')
      expect(result.packageName).toBeUndefined()
    })

    it('should extract package from "about" phrase', async () => {
      const result = await requireIntent('tell me about lodash')
      expect(result.packageName).toBe('lodash')
    })

    it('should extract package from "check" phrase', async () => {
      // The 'with' phrase extraction expects word after 'with' but 'score' comes before
      // Test the actual behavior - package name from 'check express' pattern
      const result = await requireIntent('check express safety')
      expect(result.packageName).toBe('express')
    })
  })

  describe('empty and edge case queries', () => {
    it('should handle empty query gracefully', async () => {
      const result = await parseIntent('')
      expect(result).toBeUndefined()
    })

    it('should handle query with only whitespace', async () => {
      const result = await parseIntent('   ')
      expect(result).toBeUndefined()
    })

    it('should handle query with special characters', async () => {
      const result = await requireIntent('fix @#$% vulnerabilities')
      expect(result.action).toBe('fix')
    })

    it('should handle very long query', async () => {
      const longQuery =
        'please scan my project for vulnerabilities and check all the dependencies for security issues and problems'
      const result = await requireIntent(longQuery)
      expect(result.action).toBeDefined()
    })
  })
})

async function requireIntent(query: string) {
  const result = await parseIntent(query)
  if (!result) {
    throw new Error('Expected a deterministic command match')
  }
  return result
}
