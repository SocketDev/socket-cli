/**
 * Unit tests for ask command handler.
 *
 * Tests the parseIntent function that converts natural language queries
 * into Socket CLI commands.
 */

import { describe, expect, it } from 'vitest'

import { parseIntent } from '../../../../src/commands/ask/handle-ask.mts'

describe('parseIntent', () => {
  describe('action detection', () => {
    it('should detect fix action from "fix vulnerabilities"', async () => {
      const result = await parseIntent('fix vulnerabilities')
      expect(result.action).toBe('fix')
      expect(result.command).toContain('fix')
    })

    it('should detect fix action from "resolve security issues"', async () => {
      const result = await parseIntent('resolve security issues')
      expect(result.action).toBe('fix')
    })

    it('should detect scan action from "scan for vulnerabilities"', async () => {
      const result = await parseIntent('scan for vulnerabilities')
      expect(result.action).toBe('scan')
      expect(result.command).toContain('scan')
    })

    it('should detect scan action from "check for issues"', async () => {
      const result = await parseIntent('check for issues')
      expect(result.action).toBe('scan')
    })

    it('should detect scan action from "audit my project"', async () => {
      const result = await parseIntent('audit my project')
      expect(result.action).toBe('scan')
    })

    it('should detect optimize action from "optimize dependencies"', async () => {
      const result = await parseIntent('optimize dependencies')
      expect(result.action).toBe('optimize')
      expect(result.command).toContain('optimize')
    })

    it('should detect optimize action from "replace with better alternatives"', async () => {
      const result = await parseIntent('replace with better alternatives')
      expect(result.action).toBe('optimize')
    })

    it('should detect patch action from "patch vulnerabilities"', async () => {
      const result = await parseIntent('patch vulnerabilities')
      expect(result.action).toBe('patch')
      expect(result.command).toContain('patch')
    })

    it('should detect package action from "is lodash safe"', async () => {
      const result = await parseIntent('is lodash safe')
      expect(result.action).toBe('package')
      expect(result.command).toContain('package')
    })

    it('should detect package action from "check package score"', async () => {
      const result = await parseIntent('check package score')
      expect(result.action).toBe('package')
    })
  })

  describe('severity extraction', () => {
    it('should extract critical severity', async () => {
      const result = await parseIntent('fix critical vulnerabilities')
      expect(result.severity).toBe('critical')
    })

    it('should extract high severity', async () => {
      const result = await parseIntent('scan for high severity issues')
      expect(result.severity).toBe('high')
    })

    it('should extract medium severity', async () => {
      const result = await parseIntent('show medium severity alerts')
      expect(result.severity).toBe('medium')
    })

    it('should extract low severity', async () => {
      const result = await parseIntent('fix low priority issues')
      expect(result.severity).toBe('low')
    })

    it('should add severity flag to command', async () => {
      const result = await parseIntent('fix critical issues')
      expect(result.command.some(c => c.includes('--severity=critical'))).toBe(
        true,
      )
    })
  })

  describe('environment detection', () => {
    it('should detect production environment', async () => {
      const result = await parseIntent('scan production dependencies')
      expect(result.environment).toBe('production')
    })

    it('should detect development environment', async () => {
      const result = await parseIntent('check dev dependencies')
      expect(result.environment).toBe('development')
    })

    it('should add prod flag for production scans', async () => {
      const result = await parseIntent('scan production vulnerabilities')
      expect(result.command).toContain('--prod')
    })
  })

  describe('dry run detection', () => {
    it('should detect dry run from "dry run"', async () => {
      const result = await parseIntent('fix vulnerabilities dry run')
      expect(result.isDryRun).toBe(true)
    })

    it('should detect dry run from "preview"', async () => {
      const result = await parseIntent('preview the fixes')
      expect(result.isDryRun).toBe(true)
    })

    it('should add dry-run flag to fix commands by default', async () => {
      const result = await parseIntent('fix issues')
      expect(result.command).toContain('--dry-run')
    })
  })

  describe('package name extraction', () => {
    it('should extract quoted package name', async () => {
      const result = await parseIntent('is "express" safe to use')
      expect(result.packageName).toBe('express')
    })

    it('should extract package name after "is"', async () => {
      const result = await parseIntent('is lodash safe')
      expect(result.packageName).toBe('lodash')
    })

    it('should extract scoped package name', async () => {
      const result = await parseIntent('check "@types/node" score')
      expect(result.packageName).toBe('@types/node')
    })
  })

  describe('confidence scoring', () => {
    it('should have reasonable confidence for keyword matches', async () => {
      const result = await parseIntent('scan for vulnerabilities')
      // Confidence is based on keyword overlap ratio.
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it('should return a result even for ambiguous queries', async () => {
      const result = await parseIntent('help me')
      // Should default to scan action for ambiguous queries.
      expect(result.action).toBeDefined()
      expect(result.command).toBeDefined()
    })
  })

  describe('command building', () => {
    it('should build scan create command', async () => {
      const result = await parseIntent('scan my project')
      expect(result.command).toEqual(expect.arrayContaining(['scan', 'create']))
    })

    it('should build fix command with dry-run by default', async () => {
      const result = await parseIntent('fix vulnerabilities')
      expect(result.command).toContain('fix')
      expect(result.command).toContain('--dry-run')
    })

    it('should build package score command', async () => {
      const result = await parseIntent('check package safety')
      expect(result.command).toContain('package')
      expect(result.command).toContain('score')
    })
  })

  describe('explanation generation', () => {
    it('should provide meaningful explanation for scan', async () => {
      const result = await parseIntent('scan for issues')
      expect(result.explanation).toBeTruthy()
      expect(result.explanation.length).toBeGreaterThan(10)
    })

    it('should provide meaningful explanation for fix', async () => {
      const result = await parseIntent('fix vulnerabilities')
      expect(result.explanation).toBeTruthy()
    })
  })

  describe('NLP normalization', () => {
    it('should handle verb tenses - "scanning" → scan', async () => {
      const result = await parseIntent('scanning for vulnerabilities')
      expect(result.action).toBe('scan')
    })

    it('should handle verb tenses - "fixed" → fix', async () => {
      const result = await parseIntent('fixed vulnerabilities')
      expect(result.action).toBe('fix')
    })

    it('should handle plurals - "vulnerabilities" → vulnerability', async () => {
      const result = await parseIntent('scan for vulnerabilities')
      expect(result.action).toBe('scan')
    })
  })
})
