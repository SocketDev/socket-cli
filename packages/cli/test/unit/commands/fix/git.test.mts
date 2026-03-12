/**
 * Unit tests for fix command git utilities.
 *
 * Purpose:
 * Tests git-related utilities for the fix command including
 * branch naming, commit messages, and PR body generation.
 *
 * Test Coverage:
 * - createSocketFixBranchParser
 * - getSocketFixBranchName
 * - getSocketFixBranchPattern
 * - getSocketFixCommitMessage
 * - getSocketFixPullRequestBody
 * - getSocketFixPullRequestTitle
 *
 * Related Files:
 * - commands/fix/git.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  createSocketFixBranchParser,
  genericSocketFixBranchParser,
  getSocketFixBranchName,
  getSocketFixBranchPattern,
  getSocketFixCommitMessage,
  getSocketFixPullRequestBody,
  getSocketFixPullRequestTitle,
} from '../../../../src/commands/fix/git.mts'

import type { GhsaDetails } from '../../../../src/utils/git/github.mts'

describe('fix/git utilities', () => {
  describe('getSocketFixBranchName', () => {
    it('returns correct branch name format', () => {
      expect(getSocketFixBranchName('GHSA-1234-5678-9abc')).toBe(
        'socket/fix/GHSA-1234-5678-9abc',
      )
    })

    it('handles lowercase GHSA IDs', () => {
      expect(getSocketFixBranchName('ghsa-abcd-efgh-ijkl')).toBe(
        'socket/fix/ghsa-abcd-efgh-ijkl',
      )
    })
  })

  describe('getSocketFixBranchPattern', () => {
    it('returns pattern matching any GHSA ID when no ID provided', () => {
      const pattern = getSocketFixBranchPattern()
      // RegExp.source escapes forward slashes.
      expect(pattern.source).toContain('socket')
      expect(pattern.source).toContain('fix')
      expect(pattern.source).toContain('(.+)')
    })

    it('returns specific pattern for valid GHSA ID', () => {
      const pattern = getSocketFixBranchPattern('GHSA-1234-5678-9abc')
      expect(pattern.source).toContain('GHSA-1234-5678-9abc')
    })

    it('escapes special regex characters in invalid GHSA IDs', () => {
      const pattern = getSocketFixBranchPattern('test.*pattern')
      // Special characters should be escaped.
      expect(pattern.source).toContain('test')
      expect(pattern.source).toContain('pattern')
      // Should not match unescaped patterns.
      expect(pattern.test('socket/fix/testABCpattern')).toBe(false)
      expect(pattern.test('socket/fix/test.*pattern')).toBe(true)
    })

    it('matches branch names correctly', () => {
      const pattern = getSocketFixBranchPattern()
      expect(pattern.test('socket/fix/GHSA-1234-5678-9abc')).toBe(true)
      expect(pattern.test('other/branch')).toBe(false)
      expect(pattern.test('socket/fix/')).toBe(false)
    })
  })

  describe('createSocketFixBranchParser', () => {
    it('parses socket fix branch names', () => {
      const parser = createSocketFixBranchParser()
      const result = parser('socket/fix/GHSA-1234-5678-9abc')
      expect(result).toEqual({ ghsaId: 'GHSA-1234-5678-9abc' })
    })

    it('returns undefined for non-matching branches', () => {
      const parser = createSocketFixBranchParser()
      expect(parser('main')).toBeUndefined()
      expect(parser('feature/something')).toBeUndefined()
      expect(parser('socket/other/GHSA-1234')).toBeUndefined()
    })

    it('parses with specific GHSA ID filter', () => {
      const parser = createSocketFixBranchParser('GHSA-1234-5678-9abc')
      expect(parser('socket/fix/GHSA-1234-5678-9abc')).toEqual({
        ghsaId: 'GHSA-1234-5678-9abc',
      })
      expect(parser('socket/fix/GHSA-other-ghsa-idxx')).toBeUndefined()
    })
  })

  describe('genericSocketFixBranchParser', () => {
    it('parses any socket fix branch', () => {
      expect(genericSocketFixBranchParser('socket/fix/GHSA-1234-5678-9abc')).toEqual({
        ghsaId: 'GHSA-1234-5678-9abc',
      })
      expect(genericSocketFixBranchParser('socket/fix/GHSA-aaaa-bbbb-cccc')).toEqual({
        ghsaId: 'GHSA-aaaa-bbbb-cccc',
      })
    })
  })

  describe('getSocketFixCommitMessage', () => {
    it('returns basic commit message without details', () => {
      expect(getSocketFixCommitMessage('GHSA-1234-5678-9abc')).toBe(
        'fix: GHSA-1234-5678-9abc',
      )
    })

    it('includes summary when details provided', () => {
      const details: GhsaDetails = {
        id: 'GHSA-1234-5678-9abc',
        ghsaId: 'GHSA-1234-5678-9abc',
        severity: 'HIGH',
        summary: 'Prototype pollution vulnerability',
        vulnerabilities: {
          nodes: [
            {
              package: { name: 'lodash', ecosystem: 'NPM' },
              vulnerableVersionRange: '<4.17.21',
            },
          ],
        },
      }
      expect(getSocketFixCommitMessage('GHSA-1234-5678-9abc', details)).toBe(
        'fix: GHSA-1234-5678-9abc - Prototype pollution vulnerability',
      )
    })

    it('handles empty summary', () => {
      const details: GhsaDetails = {
        id: 'GHSA-1234-5678-9abc',
        ghsaId: 'GHSA-1234-5678-9abc',
        severity: 'MODERATE',
        summary: '',
        vulnerabilities: { nodes: [] },
      }
      expect(getSocketFixCommitMessage('GHSA-1234-5678-9abc', details)).toBe(
        'fix: GHSA-1234-5678-9abc',
      )
    })
  })

  describe('getSocketFixPullRequestTitle', () => {
    it('returns single GHSA title', () => {
      expect(getSocketFixPullRequestTitle(['GHSA-1234-5678-9abc'])).toBe(
        'Fix for GHSA-1234-5678-9abc',
      )
    })

    it('returns multiple GHSAs title', () => {
      expect(
        getSocketFixPullRequestTitle([
          'GHSA-1111-2222-3333',
          'GHSA-4444-5555-6666',
        ]),
      ).toBe('Fixes for 2 GHSAs')
    })

    it('handles many GHSAs', () => {
      expect(
        getSocketFixPullRequestTitle([
          'GHSA-aaaa-bbbb-cccc',
          'GHSA-dddd-eeee-ffff',
          'GHSA-gggg-hhhh-iiii',
          'GHSA-jjjj-kkkk-llll',
        ]),
      ).toBe('Fixes for 4 GHSAs')
    })
  })

  describe('getSocketFixPullRequestBody', () => {
    it('returns basic body for single GHSA without details', () => {
      const body = getSocketFixPullRequestBody(['GHSA-1234-5678-9abc'])
      expect(body).toContain('Socket')
      expect(body).toContain('GHSA-1234-5678-9abc')
      expect(body).toContain('https://github.com/advisories/GHSA-1234-5678-9abc')
    })

    it('includes vulnerability details for single GHSA', () => {
      const details = new Map<string, GhsaDetails>([
        [
          'GHSA-1234-5678-9abc',
          {
            id: 'GHSA-1234-5678-9abc',
            ghsaId: 'GHSA-1234-5678-9abc',
            severity: 'HIGH',
            summary: 'Remote code execution',
            vulnerabilities: {
              nodes: [
                {
                  package: { name: 'evil-package', ecosystem: 'NPM' },
                  vulnerableVersionRange: '<1.0.0',
                },
              ],
            },
          },
        ],
      ])
      const body = getSocketFixPullRequestBody(['GHSA-1234-5678-9abc'], details)
      expect(body).toContain('**Vulnerability Summary:** Remote code execution')
      expect(body).toContain('**Severity:** HIGH')
      expect(body).toContain('**Affected Packages:** evil-package (NPM)')
    })

    it('returns list format for multiple GHSAs', () => {
      const body = getSocketFixPullRequestBody([
        'GHSA-1111-2222-3333',
        'GHSA-4444-5555-6666',
      ])
      expect(body).toContain('fixes for 2 GHSAs')
      expect(body).toContain('**Fixed Vulnerabilities:**')
      expect(body).toContain('- [GHSA-1111-2222-3333]')
      expect(body).toContain('- [GHSA-4444-5555-6666]')
    })

    it('includes details for multiple GHSAs when available', () => {
      const details = new Map<string, GhsaDetails>([
        [
          'GHSA-1111-2222-3333',
          {
            id: 'GHSA-1111-2222-3333',
            ghsaId: 'GHSA-1111-2222-3333',
            severity: 'CRITICAL',
            summary: 'SQL injection',
            vulnerabilities: {
              nodes: [
                {
                  package: { name: 'sql-lib', ecosystem: 'NPM' },
                  vulnerableVersionRange: '*',
                },
              ],
            },
          },
        ],
      ])
      const body = getSocketFixPullRequestBody(
        ['GHSA-1111-2222-3333', 'GHSA-4444-5555-6666'],
        details,
      )
      expect(body).toContain('SQL injection')
      expect(body).toContain('sql-lib (NPM)')
      // Second GHSA has no details.
      expect(body).toContain('- [GHSA-4444-5555-6666]')
    })

    it('deduplicates packages in single GHSA', () => {
      const details = new Map<string, GhsaDetails>([
        [
          'GHSA-1234-5678-9abc',
          {
            id: 'GHSA-1234-5678-9abc',
            ghsaId: 'GHSA-1234-5678-9abc',
            severity: 'MODERATE',
            summary: 'Test vuln',
            vulnerabilities: {
              nodes: [
                {
                  package: { name: 'pkg', ecosystem: 'NPM' },
                  vulnerableVersionRange: '<1.0.0',
                },
                {
                  package: { name: 'pkg', ecosystem: 'NPM' },
                  vulnerableVersionRange: '<2.0.0',
                },
              ],
            },
          },
        ],
      ])
      const body = getSocketFixPullRequestBody(['GHSA-1234-5678-9abc'], details)
      // Should only contain one instance of "pkg (NPM)".
      const matches = body.match(/pkg \(NPM\)/g)
      expect(matches).toHaveLength(1)
    })
  })
})
