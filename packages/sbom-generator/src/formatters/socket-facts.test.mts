/**
 * Tests for Socket Facts CodeT5 formatter.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SocketFacts } from '../types/socket-facts.mts'
import {
  estimateSocketFactsTokenCount,
  formatSocketFactsForCodeT5,
} from './socket-facts.mts'

describe('formatSocketFactsForCodeT5', () => {
  it('should format Socket Facts with reachability context', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts)

    // Verify structure.
    expect(prompt).toContain('TASK: Perform reachability-aware security analysis')
    expect(prompt).toContain('REACHABILITY CONTEXT:')
    expect(prompt).toContain('PROJECT OVERVIEW:')
    expect(prompt).toContain('CRITICAL ISSUES (REACHABLE):')
    expect(prompt).toContain('COMPONENT SUMMARY')
    expect(prompt).toContain('ANALYSIS REQUIREMENTS:')
  })

  it('should prioritize reachable vulnerabilities', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts)

    // Verify reachable vulnerabilities appear first.
    const reachableIndex = prompt.indexOf('🔴 REACHABLE')
    const unreachableIndex = prompt.indexOf('⚪ UNREACHABLE')

    // Reachable should appear before unreachable (or unreachable should not appear).
    if (unreachableIndex !== -1) {
      expect(reachableIndex).toBeLessThan(unreachableIndex)
    }

    // Verify specific vulnerabilities.
    expect(prompt).toContain('lodash@4.17.15')
    expect(prompt).toContain('GHSA-29mw-wpgm-hmr9')
    expect(prompt).toContain('confidence: 0.95')
  })

  it('should include call stacks for reachable vulnerabilities', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      includeCallStacks: true,
    })

    // Verify call stack information.
    expect(prompt).toContain('Call Stack')
    expect(prompt).toContain('your-app/src/index.js:42')
    expect(prompt).toContain('node_modules/lodash/merge.js')
  })

  it('should filter out unreachable vulnerabilities by default', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      includeUnreachable: false,
    })

    // Verify unreachable vulnerabilities are not included.
    expect(prompt).not.toContain('VULNERABILITIES (UNREACHABLE):')
    expect(prompt).not.toContain('xmldom@0.5.0')
    expect(prompt).not.toContain('yargs-parser@15.0.0')
  })

  it('should include unreachable vulnerabilities when requested', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      includeUnreachable: true,
    })

    // Verify unreachable vulnerabilities are included.
    expect(prompt).toContain('VULNERABILITIES (UNREACHABLE):')
    expect(prompt).toContain('xmldom@0.5.0')
    expect(prompt).toContain('CVE-2021-32796')
  })

  it('should respect minConfidence option', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      minConfidence: 0.9,
    })

    // Only lodash@4.17.15 has confidence >= 0.9.
    expect(prompt).toContain('lodash@4.17.15')
    expect(prompt).toContain('confidence: 0.95')

    // axios@0.21.0 has confidence 0.87, should be filtered out.
    expect(prompt).not.toContain('axios@0.21.0')
  })

  it('should format for different task types', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const securityPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      task: 'security-analysis',
    })
    const vulnPrompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      task: 'vulnerability-detection',
    })

    expect(securityPrompt).toContain('security analysis')
    expect(vulnPrompt).toContain('vulnerabilities and assess exploitability')
  })

  it('should generate token-efficient output', async () => {
    const socketFactsPath = path.join(
      __dirname,
      '../../test/fixtures/socket-facts-sample.json'
    )
    const socketFactsJson = await readFile(socketFactsPath, 'utf8')
    const socketFacts: SocketFacts = JSON.parse(socketFactsJson)

    const prompt = formatSocketFactsForCodeT5(socketFacts, undefined, {
      includeUnreachable: false,
    })

    const tokenCount = estimateSocketFactsTokenCount(prompt)

    // For 5 components (2 reachable, 3 unreachable), expect < 500 tokens.
    // With includeUnreachable: false, should be even less.
    expect(tokenCount).toBeLessThan(500)
  })

  it('should handle empty Socket Facts', () => {
    const socketFacts: SocketFacts = {
      components: [],
    }

    const prompt = formatSocketFactsForCodeT5(socketFacts)

    expect(prompt).toContain('TASK:')
    expect(prompt).toContain('PROJECT OVERVIEW:')
    expect(prompt).not.toContain('CRITICAL ISSUES')
  })

  it('should handle Socket Facts without reachability data', async () => {
    const socketFacts: SocketFacts = {
      components: [
        {
          type: 'npm',
          name: 'test-package',
          version: '1.0.0',
          id: 'pkg:npm/test-package@1.0.0',
          direct: true,
          dev: false,
          dead: false,
          vulnerabilities: [
            {
              ghsaId: 'GHSA-test-1234',
              range: '<2.0.0',
              reachabilityData: {
                publicComment: 'Test vulnerability',
                pattern: [],
                undeterminableReachability: true,
              },
            },
          ],
          // No reachability field.
        },
      ],
    }

    const prompt = formatSocketFactsForCodeT5(socketFacts)

    expect(prompt).toContain('PROJECT OVERVIEW:')
    expect(prompt).not.toContain('CRITICAL ISSUES')
  })
})

describe('estimateSocketFactsTokenCount', () => {
  it('should estimate token count correctly', () => {
    const prompt = 'This is a test prompt with about 10 words in it.'
    const tokenCount = estimateSocketFactsTokenCount(prompt)

    // Rough estimate: 4 characters per token.
    const expectedTokens = Math.ceil(prompt.length / 4)
    expect(tokenCount).toBe(expectedTokens)
  })

  it('should handle empty prompts', () => {
    const tokenCount = estimateSocketFactsTokenCount('')
    expect(tokenCount).toBe(0)
  })
})
